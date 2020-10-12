import AWS = require('aws-sdk');
import fs = require('fs');
import {SqlParametersList} from 'aws-sdk/clients/rdsdataservice';

const {AWS_REGION, APIG_ID_WS, APIG_ID_HTTP, DB_ARN, DB_SECRET} = process.env;
const CLIENT_JS = fs.readFileSync(`${__dirname}/client/client.js`, 'utf8');
const CLIENT_HTML = fs.readFileSync(`${__dirname}/client/index.html`, 'utf8');

const rdsData = new AWS.RDSDataService()
const apigMgmt = new AWS.ApiGatewayManagementApi({
  endpoint: `https://${APIG_ID_WS}.execute-api.${AWS_REGION}.amazonaws.com/production`
});

type TGameStatus = 'needOpponent' | 'userTurn' | 'opponentTurn' | 'userWin' | 'opponentWin';
type TPlayerCell = 'waterHit' | 'waterHidden' | 'shipHit' | 'shipHidden'
type TOpponentCell = 'unknown' | 'waterHit' | 'shipHit'
type TBattleshipState = {
  opponent: string | null
  status: TGameStatus;
  playerState: TPlayerCell[][];
  opponentState: TOpponentCell[][];
}

type TWsInEvent =
  | { type: 'ready' }
  | { type: 'submitGuess', row: number, col: number }
type TWsOutEvent = { type: 'update', state: TBattleshipState }

exports.handler = async (evt: any) => {
  console.log("event=", evt)
  try {
    let resp = await routeRequest(evt);
    return {statusCode: 200, ...resp};
  } catch (e) {
    console.error("error", e)
    return {statusCode: 500, body: "Unknown Error"}
  }
};

async function routeRequest(evt: any) {
  const {routeKey, connectionId, path} = evt.requestContext || {};
  switch (routeKey) {
    case '$connect':
      return handleWsConnect(connectionId, evt.queryStringParameters);
    case '$disconnect':
      return handleWsDisconnect(connectionId);
    case '$default':
      return handleWsMessage(connectionId, evt.body);
  }

  switch (path) {
    case '/production/list-games':
      return handleHttpListGames(evt.queryStringParameters)
    case '/production/start-new-game':
      return handleHttpStartNewGame(evt.queryStringParameters)
    case '/production/client.js':
      return handleHttpClientJs();
    case '/production/index.html':
      return handleHttpIndexHtml();
    case '/production':
    case '/production/':
      return handleHttpIndexRedirect();
  }

  console.log('404', evt);
  return {statusCode: 404, body: `Not Found: ${path}`};
}

async function handleWsConnect(connectionId: string, params: Record<string, string>) {
  console.log("ws:connecting", {connectionId, params})

  const {username, gameId} = params;
  if (!username) throw new Error("Missing username");
  if (!gameId) throw new Error("Missing gameId");

  const {player_a, player_b} = await dbQueryGamePlayers(gameId);

  const isAllowed = player_a === username || player_b === username || player_b == null;
  if (!isAllowed) return new Error("Game is already being used by others");

  const isGameNowReady = player_b === null && player_a !== username;

  if (isGameNowReady) {
    const didUpdate = await dbWriteSecondPlayerToGame(gameId, username, randomBool() ? player_a : username);
    if (!didUpdate) throw new Error("Someone else connected already");
  }
  await dbInsertConnection(connectionId, gameId, username);

  if (isGameNowReady) {
    const game = await dbQueryGame(gameId);
    const connections = await dbQueryConnectionsForGame(gameId);
    await Promise.all(connections.map(async c => {
      if (c.conn_id === connectionId) return;
      try {
        await wsSend(c.conn_id, {type: 'update', state: getStateFromGame(game, c.username)})
      } catch (error) {
        console.error("unable to notifiy opponent of update", error);
        //this could be more robust
      }
    }))
  }

  return null;
}

async function handleWsDisconnect(connectionId: string) {
  console.log("ws:disconnecting", {connectionId})
  await dbDeleteConnection(connectionId);
  return null;
}

async function handleWsMessage(connectionId: string, body: string) {
  console.log("ws:message", {connectionId, body})
  const user = await dbQueryConnection(connectionId);

  const event: TWsInEvent = JSON.parse(body);
  if (event.type === 'ready') {
    await handleWsMessage_ready(connectionId, user.username, user.game_id)
  } else if (event.type === 'submitGuess') {
    await handleWsMessage_submitGuess(connectionId, user.username, user.game_id, event.row, event.col)
  } else {
    throw new Error(`Unknown event type: ${body}`)
  }

  return {body: 'ok'}
}

async function handleWsMessage_ready(connectionId: string, username: string, gameId: string) {
  const game = await dbQueryGame(gameId);
  await wsSend(connectionId, {type: 'update', state: getStateFromGame(game, username)})
}

async function handleWsMessage_submitGuess(connectionId: string, username: string, gameId: string, row: number, col: number) {
  const game = await dbQueryGame(gameId);
  if (game.player_b === null) throw new Error("Still waiting on an opponent")

  const targetGrid = game.player_a === username ? game.grid_b : game.grid_a;
  const targetCell = targetGrid[row][col];
  if (targetCell === 'shipHit' || targetCell === 'waterHit') {
    console.log("client clicked something that was already hit. Send them same state back")
    await wsSend(connectionId, {type: 'update', state: getStateFromGame(game, username)});
    return;
  }

  if (targetCell === 'shipHidden') targetGrid[row][col] = 'shipHit';
  else if (targetCell === 'waterHidden') targetGrid[row][col] = 'waterHit';
  else throw new Error(`Unexpected targetCell value: ${targetCell}`)

  if (targetGrid.every(row => row.every(cell => cell !== 'shipHidden'))) {
    game.player_victor = username;
  }

  game.player_turn = game.player_a === username ? game.player_b : game.player_a;
  await dbWriteGameAfterGuess(gameId, game, username);

  const connections = await dbQueryConnectionsForGame(gameId)
  await Promise.all(connections.map(async c => {
    try {
      await wsSend(c.conn_id, {type: 'update', state: getStateFromGame(game, c.username)})
    } catch (error) {
      console.error("unable to notifiy opponent of update", error);
      //this could be more robust
    }
  }))
}

async function handleHttpListGames(params: { username: string }) {
  if (!params.username) throw new Error("Missing username");
  const rows = await dbQueryGamesForUser(params.username);
  const games = rows.map(r => ({
    id: r.id,
    players: r.player_b ? [r.player_a, r.player_b] : [r.player_a],
    turn: r.player_turn ?? null,
  }));
  return jsonResponse({games});
}

async function handleHttpStartNewGame(params: { username: string }) {
  if (!params.username) throw new Error("Missing username");
  const {id} = await dbInsertNewGame(params.username, createNewBattleshipGrid(), createNewBattleshipGrid());
  return jsonResponse({id});
}

async function handleHttpIndexRedirect() {
  return {statusCode: 302, headers: {location: '/production/index.html'}}
}

export async function handleHttpClientJs() {
  const config = JSON.stringify({AWS_REGION, APIG_ID_HTTP, APIG_ID_WS});
  const result = CLIENT_JS.replace(/CONFIG_START[\s\S]*CONFIG_END/m, 'CONFIG_START*/' + config + '/*CONFIG_END');
  return {body: result, headers: {'content-type': 'text/javascript'}}
}

async function handleHttpIndexHtml() {
  return {body: CLIENT_HTML, headers: {'content-type': 'text/html'}}
}

/***** Battleship Utilities *****/

function getStateFromGame(game: TDbGame, user: string): TBattleshipState {
  const [playerGrid, opponentGrid] = game.player_a === user ? [game.grid_a, game.grid_b] : [game.grid_b, game.grid_a];
  const obscuredGrid = opponentGrid.map(row => row.map(cell => {
    if (cell === 'shipHidden' || cell === 'waterHidden') return 'unknown'
    return cell;
  }))

  let status: TGameStatus;
  if (game.player_victor === user) status = 'userWin';
  else if (game.player_victor !== null) status = 'opponentWin';
  else if (game.player_turn === user) status = 'userTurn';
  else if (game.player_b === null) status = 'needOpponent';
  else status = 'opponentTurn';

  return {
    opponent: game.player_a === user ? game.player_b : game.player_a,
    status,
    playerState: playerGrid,
    opponentState: obscuredGrid,
  };
}

function createNewBattleshipGrid(): TPlayerCell[][] {
  const grid: TPlayerCell[][] = Array.from({length: 10}, () => Array.from({length: 10}, () => 'waterHidden'));

  // There may be more computationally efficient means of randomly placing ships,
  // but retrying with new random values if you get a collision is conceptually simple.
  const shipsToPlace = [2, 3, 3, 4, 5];
  while (true) {
    const shipLen = shipsToPlace.pop();
    if (!shipLen) break;
    const isHoriz = randomBool();
    const r = randomInt(0, 10 - shipLen);
    const c = randomInt(0, 10 - shipLen);

    const rStep = isHoriz ? 0 : 1;
    const cStep = isHoriz ? 1 : 0;

    let canPlace = true;
    for (let i = 0; i < shipLen; i++) {
      if (grid[r + (rStep * i)][c + (cStep * i)] !== 'waterHidden') {
        canPlace = false;
      }
    }

    if (canPlace) {
      for (let i = 0; i < shipLen; i++) {
        grid[r + (rStep * i)][c + (cStep * i)] = 'shipHidden'
      }
    } else {
      // try again
      shipsToPlace.push(shipLen);
    }
  }

  return grid;
}

/***** DB Functions *****/

type TDbGame = {
  player_a: string,
  player_b: string | null,
  grid_a: TPlayerCell[][],
  grid_b: TPlayerCell[][],
  player_turn: string,
  player_victor: string | null
};

async function dbQueryGame(gameId: string): Promise<TDbGame> {
  const {rows} = await execSql(`
    SELECT player_a, player_b, grid_a, grid_b, player_turn, player_victor 
    FROM game WHERE id::text = :game_id`, [
    {name: 'game_id', value: {stringValue: gameId}}
  ])
  const game: TDbGame = rows[0];
  if (!game) throw new Error(`invalid gameid: ${gameId}`)
  // work around issue where json columns come back as text
  game.grid_a = JSON.parse(game.grid_a as any);
  game.grid_b = JSON.parse(game.grid_b as any);
  return game;
}

async function dbQueryGamePlayers(gameId: string): Promise<{player_a: string, player_b: string | null}> {
  const {rows} = await execSql(`SELECT player_a, player_b FROM game WHERE id::text = :gameId`, [
    {name: 'gameId', value: {stringValue: gameId}}
  ]);
  if (rows.length !== 1) throw new Error("Invalid gameId");
  return rows[0];
}

async function dbQueryGamesForUser(username: string): Promise<TDbGameListItem[]> {
  const {rows} = await execSql(`
  SELECT id, player_a, player_b, player_turn 
  FROM game 
  WHERE player_victor is null 
    AND (player_a = :username OR player_b = :username OR player_b is null) 
  `, [
    {name: 'username', value: {stringValue: username}}
  ])
  return rows;
}

async function dbInsertNewGame(username: string, grid_a: TPlayerCell[][], grid_b: TPlayerCell[][]): Promise<{ id: string }> {
  const sql = `
  INSERT INTO game(player_a, grid_a, grid_b) 
  VALUES(:player_a, (:grid_a)::json, (:grid_b)::json)
  RETURNING id 
  `;
  const {rows} = await execSql(sql, [
    {name: 'player_a', value: {stringValue: username}},
    {name: 'grid_a', value: {stringValue: JSON.stringify(grid_a)}},
    {name: 'grid_b', value: {stringValue: JSON.stringify(grid_b)}},
  ]);
  return rows[0];
}

async function dbWriteGameAfterGuess(gameId: string, game: TDbGame, username: string) {
  const gridcolumn = game.player_a === username ? 'grid_b' : 'grid_a';
  const targetGrid = game.player_a === username ? game.grid_b : game.grid_a;

  let query = `
  UPDATE game 
  SET ${gridcolumn} = (:grid)::json, player_turn = :player_turn, player_victor = :player_victor
  WHERE id::text = :id
  `;
  console.log(query, targetGrid);
  await execSql(query, [
    {name: 'grid', value: {stringValue: JSON.stringify(targetGrid)}},
    {name: 'player_turn', value: {stringValue: game.player_turn}},
    {
      name: 'player_victor',
      value: game.player_victor ? {stringValue: game.player_victor} : {isNull: true}
    },
    {name: 'id', value: {stringValue: gameId}},
  ])
}

async function dbWriteSecondPlayerToGame(gameId: string, username: string, player_turn: string) {
  const sql = `
    UPDATE game 
    SET player_b = :player_b
      , player_turn = :player_turn
    WHERE id::text = :game_id AND player_b is null`;
  const {updates} = await execSql(sql, [
    {name: 'game_id', value: {stringValue: gameId}},
    {name: 'player_b', value: {stringValue: username}},
    {name: 'player_turn', value: {stringValue: player_turn}},
  ])
  return updates === 1;
}

type TDbGameListItem = { id: string, player_a: string, player_b: string | null, player_turn: string | null };

async function dbQueryConnection(connectionId: string): Promise<{ game_id: string, username: string }> {
  const {rows} = await execSql(`SELECT game_id, username FROM websocket WHERE conn_id = :id`, [
    {name: 'id', value: {stringValue: connectionId}}
  ]);
  if (!rows.length) throw new Error(`invalid connection id:${connectionId}`);

  return rows[0];
}

async function dbQueryConnectionsForGame(gameId: string): Promise<{ conn_id: string, username: string }[]> {
  const {rows} = await execSql(`
    SELECT conn_id, username FROM websocket WHERE game_id::text = :game_id 
  `, [
    {name: 'game_id', value: {stringValue: gameId}},
  ])
  return rows;
}

async function dbInsertConnection(connectionId: string, gameId: string, username: string) {
  await execSql(
    `INSERT INTO websocket(conn_id, game_id, username) VALUES (:conn_id, :game_id::uuid, :username)`,
    [
      {name: 'conn_id', value: {stringValue: connectionId}},
      {name: 'game_id', value: {stringValue: gameId}},
      {name: 'username', value: {stringValue: username}},
    ]
  )
}

async function dbDeleteConnection(connectionId: string) {
  await execSql(
    `DELETE FROM websocket WHERE conn_id = :conn_id`,
    [
      {name: 'conn_id', value: {stringValue: connectionId}},
    ]
  )
}

/***** Utilities *****/
function jsonResponse(body: object) {
  return {body: JSON.stringify(body), headers: {'content-type': 'application/json'}}
}

async function execSql(query: string, params?: SqlParametersList) {
  const resp = await rdsData.executeStatement({
    resourceArn: DB_ARN!,
    secretArn: DB_SECRET!,
    database: 'battleship',
    parameters: params ?? [],
    sql: query,
    includeResultMetadata: true,
    continueAfterTimeout: false,
  }).promise()
  const columns = resp.columnMetadata ?? [];
  const records = resp.records ?? [];

  const rows = records.map(row => {
    const entries = row.map((it, ndx) => [columns[ndx].name, mapSqlValue(it)]);
    return Object.fromEntries(entries)
  });
  return {
    rows,
    updates: resp.numberOfRecordsUpdated ?? 0
  }

  function mapSqlValue(v: AWS.RDSDataService.Field): any {
    if (v.isNull) return null;
    if ('blobValue' in v) return v.blobValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('longValue' in v) return v.longValue;
    if ('doubleValue' in v) return v.doubleValue;
    if ('stringValue' in v) return v.stringValue;
    if ('arrayValue' in v) return mapSqlArrayValues(v.arrayValue!);
    throw new Error(`Unknown type: ${JSON.stringify(v)}`)
  }

  function mapSqlArrayValues(v: AWS.RDSDataService.ArrayValue): any {
    if ('arrayValues' in v) return v.arrayValues!.map(mapSqlArrayValues);
    if ('booleanValues' in v) return v.booleanValues
    if ('doubleValues' in v) return v.doubleValues
    if ('longValues' in v) return v.longValues
    if ('stringValues' in v) return v.stringValues
    throw new Error(`Unknown array type: ${JSON.stringify(v)}`)
  }
}

async function wsSend(connectionId: string, data: TWsOutEvent) {
  await apigMgmt.postToConnection({
    ConnectionId: connectionId,
    Data: JSON.stringify(data),
  }).promise()
}

function randomBool() {
  return Math.random() >= 0.5;
}

function randomInt(minInclusive: number, maxExclusive: number) {
  return Math.floor(Math.random() * (maxExclusive - minInclusive)) + minInclusive;
}
