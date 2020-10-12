type TLoginCtx = { username: string | null, setUsername: (val: string | null) => void };

const CONFIG = /*CONFIG_START*/{
  AWS_REGION: 'us-west-2',
  APIG_ID_HTTP: 'mqfpjul7lj',
  APIG_ID_WS: '2h877ibmk6',
}/*CONFIG_END*/;

const WS_ORIGIN = `wss://${CONFIG.APIG_ID_WS}.execute-api.${CONFIG.AWS_REGION}.amazonaws.com`;
const HTTP_ORIGIN = `https://${CONFIG.APIG_ID_HTTP}.execute-api.${CONFIG.AWS_REGION}.amazonaws.com`;
const LoginCtx = React.createContext<TLoginCtx>(null as any);

function useLogin(): TLoginCtx {
  return React.useContext(LoginCtx)
}

function Root() {
  return (
    <ReactRouterDOM.HashRouter>
      <LoginCtxProvider>
        <ReactRouterDOM.Switch>
          <ReactRouterDOM.Route path="/game/:gameId"><Game.Page/></ReactRouterDOM.Route>
          <ReactRouterDOM.Route path="/game-select"><GameSelect.Page/></ReactRouterDOM.Route>
          <ReactRouterDOM.Route path="/login"><Login.Page/></ReactRouterDOM.Route>
          <ReactRouterDOM.Route path="/"><Base/></ReactRouterDOM.Route>
        </ReactRouterDOM.Switch>
      </LoginCtxProvider>
    </ReactRouterDOM.HashRouter>
  )
}

function LoginCtxProvider(props: React.PropsWithChildren<{}>) {
  const [username, setUsername] = React.useState(() => window.sessionStorage.getItem('username') || null)

  const ctx = React.useMemo<TLoginCtx>(() => ({
    username,
    setUsername: (val) => {
      console.log(val, val || null)
      window.sessionStorage.setItem('username', val || '');
      setUsername(val || null);
    }
  }), [username, setUsername]);

  console.log(username, ctx,);
  return <LoginCtx.Provider value={ctx}>{props.children}</LoginCtx.Provider>
}

function Base() {
  const login = useLogin()
  return <ReactRouterDOM.Redirect to={login.username ? '/game-select' : '/login'}/>;
}

namespace Login {
  export function Page() {
    const login = useLogin()
    const [name, setName] = React.useState("");

    if(login.username) return <ReactRouterDOM.Redirect push to='/game-select'/>

    return <div>
      <h1>Login</h1>
      <div>
        <label>
          Name:
          <input type="text" value={name} onChange={e => setName(e.currentTarget.value)}
                 onKeyDown={handleKeyDown}/>
        </label>
      </div>
      <button onClick={handleLoginClick}>Login</button>
    </div>

    function handleKeyDown(e: React.KeyboardEvent) {
      if (e.key === 'Enter') {
        handleLoginClick();
      }
    }

    function handleLoginClick() {
      login.setUsername(name);
    }
  }
}

namespace GameSelect {
  export function Page() {
    const login = useLogin();
    if (!login.username) return <ReactRouterDOM.Redirect to='/login'/>

    return <div>
      <p>
        Hello, {login.username}.&nbsp;
        <button onClick={() => login.setUsername(null)}>Logout</button>
      </p>
      <GameListing username={login.username}/>
    </div>;
  }

  interface TOpenGame {
    id: string;
    players: [string, string?];
    turn: string | null;
  }

  function GameListing({username}: { username: string }) {
    const [games, setGames] = React.useState<TOpenGame[] | null>(null);
    const [refreshTick, setRefreshTick] = React.useState(0);

    React.useEffect(() => {
      apiFetchGames(username)
        .then(setGames)
        .catch(fatalError)
    }, [username, refreshTick])

    if (!games) return <div>Loading...</div>

    return (<>
      <GamesSubset title="Games waiting on you"
                   username={username}
                   games={games.filter(g => g.turn && g.turn === username)}/>
      <GamesSubset title="Games waiting on opponent"
                   username={username}
                   games={games.filter(g => g.turn && g.turn !== username)}/>
      <GamesSubset title="Games you can join"
                   username={username}
                   games={games.filter(g => !g.turn && g.players[0] !== username)}/>
      <GamesSubset title="Games waiting for someone to join"
                   username={username}
                   games={games.filter(g => !g.turn && g.players[0] === username)}/>
      <p>
        <StartNewButton username={username}/>
        <button onClick={handleRefreshClick}>Refresh</button>
      </p>
    </>)

    function handleRefreshClick() {
      setRefreshTick(prev => prev + 1)
    }
  }

  function StartNewButton({username}: { username: string }) {
    const [status, setStatus] = React.useState<'READY' | 'LOADING' | { id: string }>('READY');
    if (typeof status === 'object') return <ReactRouterDOM.Redirect push to={`/game/${status.id}`}/>
    if (status === 'LOADING') return <button>Starting...</button>
    return <button onClick={handleStartNewClick}>Start New Game</button>

    function handleStartNewClick() {
      setStatus('LOADING');
      apiStartNewGame(username)
        .then(setStatus)
        .catch(fatalError)
    }
  }

  async function apiFetchGames(username: string): Promise<TOpenGame[]> {
    const search = queryString({username});
    const resp = await fetch(`${HTTP_ORIGIN}/production/list-games?${search}`, {method: 'GET'})
    if (!resp.ok) throw resp;
    const result = await resp.json();
    return result.games;
  }

  async function apiStartNewGame(username: string): Promise<{ id: string }> {
    const search = queryString({username});
    const resp = await fetch(`${HTTP_ORIGIN}/production/start-new-game?${search}`, {method: 'POST'})
    if (!resp.ok) throw resp;
    return resp.json();
  }

  function GamesSubset(props: { title: string, games: TOpenGame[], username: string }) {
    const {title, games, username} = props;
    if (!games.length) return null;

    return (
      <>
        <h2>{title}</h2>
        <ul>{games.map(g =>
          <li key={g.id}>
            <ReactRouterDOM.Link
              to={`/game/${g.id}`}>{renderTitle(username, g.players)}</ReactRouterDOM.Link>
          </li>
        )}</ul>
      </>
    )
  }

  function renderTitle(username: string, players: [string, string?]) {
    if (players.length === 2) return `vs ${players.find(it => it !== username)}`
    if (players[0] !== username) return `vs ${players[0]}`
    return `Not yet started`
  }
}

namespace Game {
  export function Page() {
    const login = React.useContext(LoginCtx)
    const {gameId} = ReactRouterDOM.useParams<{ gameId: string }>()
    if (!login.username) return <ReactRouterDOM.Redirect to='/login'/>

    return <div>
      <ReactRouterDOM.Link to={"/game-select"}>&lt; Return to game select</ReactRouterDOM.Link>
      <GameDetails username={login.username} gameId={gameId}/>
    </div>
  }

  function GameDetails(props: { username: string, gameId: string }) {
    const engine = useBattleshipEngine(props.username, props.gameId);
    if (engine === 'CONNECTING') return <div>Connecting...</div>
    if (engine === 'LOADING') return <div>Loading...</div>
    if (engine === 'ERROR') return (
      <div>
        <h1>Unable to connect to game</h1>
        <p>
          The game may not exist, may belong to other players or an error
          may have kicked you out of the game.
        </p>
      </div>
    )

    return <div>
      <div className={'status ' + engine.status}>{renderStatus(engine)}</div>
      <div className="boardContainer">
        <table className="gameBoard">
          <thead>
          <tr>
            <th colSpan={10}>You</th>
          </tr>
          </thead>
          <PlayerBoard engine={engine}/>
        </table>
        <table className="gameBoard">
          <thead>
          <tr>
            <th colSpan={10}>{engine.opponent ?? "[Waiting for your opponent to join]"}</th>
          </tr>
          </thead>
          <OpponentBoard engine={engine}/>
        </table>
      </div>
    </div>
  }

  function renderStatus(engine: TBattleshipEngine) {
    switch (engine.status) {
      case 'userTurn':
        return "YOUR TURN";
      case 'needOpponent':
        return "Waiting on an opponent to join the game..."
      case 'serverWait':
        return "Processing request..."
      case 'opponentTurn':
        return "Opponent's turn"
      case 'userWin':
        return "You win!"
      case 'opponentWin':
        return "You lost."
    }
  }

  type TGameStatus = 'needOpponent' | 'userTurn' | 'serverWait' | 'opponentTurn' | 'userWin' | 'opponentWin';
  type TPlayerCell = 'waterHit' | 'waterHidden' | 'shipHit' | 'shipHidden'
  type TOpponentCell = 'unknown' | 'waterHit' | 'shipHit'

  type TBattleshipState = {
    opponent: string | null
    status: TGameStatus;
    playerState: TPlayerCell[][];
    opponentState: TOpponentCell[][];
  }

  type TBattleshipEngine = TBattleshipState & {
    submitGuess(row: number, col: number): void;
  }

  type TEngineState = 'CONNECTING' | 'LOADING' | 'ERROR' | TBattleshipEngine
  type TWsInEvent = { type: 'update', state: TBattleshipState }
  type TWsOutEvent =
    | { type: 'ready' }
    | { type: 'submitGuess', row: number, col: number }

  function useBattleshipEngine(username: string, gameId: string): TEngineState {
    const [state, setState] = React.useState<TEngineState>('CONNECTING')
    const [reconnTick, setReconnTick] = React.useState(0)

    React.useEffect(() => {
      let wantingClose = false;
      let ws = new WebSocket(`${WS_ORIGIN}/production?${queryString({username, gameId})}`);

      ws.addEventListener('error', () => {
        wantingClose = true;
        setState('ERROR')
        ws.close();
      })
      ws.addEventListener('close', () => {
        if (!wantingClose) {
          setReconnTick(prev => prev + 1)
          setState('CONNECTING');
        }
      });
      ws.addEventListener('open', () => {
        setState('LOADING');
        wsSend({type: 'ready'})
      })
      ws.addEventListener('message', (evt) => {
        const data: TWsInEvent = JSON.parse(evt.data);
        switch (data.type) {
          case 'update':
            setState({...data.state, submitGuess: handleSubmitGuess})
            return;
        }
      })

      function handleSubmitGuess(row: number, col: number) {
        setState(prev => {
          if (typeof prev === 'string') return prev;
          if (prev.status !== 'userTurn') return prev;
          wsSend({type: 'submitGuess', row, col})
          return {...prev, status: 'serverWait'}
        })
      }

      function wsSend(msg: TWsOutEvent) {
        ws.send(JSON.stringify(msg));
      }

      return () => {
        wantingClose = true;
        if(ws.readyState === WebSocket.OPEN){
          ws.close();
        }
      }
    }, [username, gameId, reconnTick])

    return state;
  }

  function PlayerBoard({engine}: { engine: TBattleshipEngine }) {
    return <tbody>{engine.playerState.map((row, rNdx) =>
      <tr key={rNdx}>{row.map((cellClass, cNdx) =>
        <td key={cNdx} className={cellClass}/>
      )}</tr>
    )}</tbody>
  }

  function OpponentBoard({engine}: { engine: TBattleshipEngine }) {
    const className = engine.status === 'userTurn' ? 'clickable' : '';

    return <tbody className={className}>{engine.opponentState.map((row, rNdx) =>
      <tr key={rNdx}>{row.map((cellClass, cNdx) =>
        <td key={cNdx} className={cellClass} onClick={() => handleCellClick(rNdx, cNdx)}/>
      )}</tr>
    )}</tbody>

    function handleCellClick(row: number, cell: number) {
      if (engine.status !== 'userTurn') return;
      if (engine.opponentState[row][cell] !== 'unknown') return;
      engine.submitGuess(row, cell)
    }
  }
}

function queryString(data: Record<string, string>) {
  return new URLSearchParams(Object.entries(data)).toString()
}

function fatalError(error: unknown) {
  console.log("Fatal Error", error);
  window.alert("An unknown error has put the application in an unknown state")
}

ReactDOM.render(<Root/>, document.getElementById('app'))
