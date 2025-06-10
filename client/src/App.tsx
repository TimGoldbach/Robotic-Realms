import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import './index.css';

// Socket Context
const SocketContext = React.createContext<Socket | null>(null);

function useSocket() {
  return React.useContext(SocketContext);
}

// Lobby Interface
interface Lobby {
  id: string;
  pin: string;
  players: { id: string; name: string }[];
  maxPlayers: number;
  started: boolean;
}

// Home Component
function Home() {
  const [playerName, setPlayerName] = useState('');
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const navigate = useNavigate();
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;

    socket.emit('getLobbies');

    socket.on('lobbyList', (lobbyList: Lobby[]) => {
      console.log('Received lobby list:', lobbyList);
      setLobbies(lobbyList);
    });

    socket.on('lobbyCreated', (lobby: Lobby) => {
      console.log('Lobby created:', lobby);
      navigate(`/lobby/${lobby.id}`);
    });

    socket.on('lobbyJoined', (lobby: Lobby) => {
      console.log('Joined lobby:', lobby);
      navigate(`/lobby/${lobby.id}`);
    });

    socket.on('lobbyError', (error: string) => {
      console.error('Lobby error:', error);
      setJoinError(error);
      setTimeout(() => setJoinError(null), 3000);
    });

    return () => {
      socket.off('lobbyList');
      socket.off('lobbyCreated');
      socket.off('lobbyJoined');
      socket.off('lobbyError');
    };
  }, [socket, navigate]);

  const createLobby = () => {
    if (!socket) {
      console.error('Socket not connected');
      setJoinError('Connection error. Please try again.');
      return;
    }

    if (!playerName.trim()) {
      setJoinError('Please enter your name');
      return;
    }

    console.log('Creating lobby with name:', playerName);
    console.log('Socket connection state:', socket.connected);
    console.log('Socket ID:', socket.id);
    
    localStorage.setItem('playerName', playerName);
    socket.emit('createLobby', { playerName }, (response: any) => {
      console.log('Create lobby response:', response);
    });
  };

  const joinLobbyByPin = () => {
    if (!socket) {
      console.error('Socket not connected');
      setJoinError('Connection error. Please try again.');
      return;
    }

    if (!playerName.trim()) {
      setJoinError('Please enter your name');
      return;
    }
    if (pinInput.length !== 6) {
      setJoinError('Please enter a valid 6-digit pin');
      return;
    }

    console.log('Joining lobby with pin:', pinInput);
    localStorage.setItem('playerName', playerName);
    socket.emit('joinLobby', { pin: pinInput, playerName });
  };

  return (
    <div className="container mx-auto p-4 min-h-screen">
      <h1 className="text-4xl font-bold mb-8 robot-title text-center">Robotic Realms</h1>
      
      {/* Name Input */}
      <div className="mb-8">
        <input
          type="text"
          placeholder="Enter your name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          className="robot-input w-full p-3 rounded-lg mb-4"
        />
      </div>

      {/* Create Lobby Section */}
      <div className="mb-8 robot-card p-6 rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">Create New Game</h2>
        <button
          onClick={createLobby}
          className="robot-button w-full bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-3 rounded-lg font-semibold"
        >
          Create Lobby
        </button>
      </div>

      {/* Join Lobby Section */}
      <div className="mb-8 robot-card p-6 rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">Join Existing Game</h2>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="Enter 6-digit lobby pin"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="robot-input flex-1 p-3 rounded-lg"
          />
          <button
            onClick={joinLobbyByPin}
            className="robot-button bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-3 rounded-lg font-semibold"
          >
            Join Game
          </button>
        </div>
        {joinError && (
          <div className="text-red-400 text-sm mt-2">
            {joinError}
          </div>
        )}
      </div>

      {/* Available Lobbies Section */}
      <div className="robot-card p-6 rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">Available Lobbies</h2>
        <div className="grid gap-4">
          {lobbies.map((lobby) => (
            <div key={lobby.id} className="robot-card p-4 rounded-lg">
              <div className="flex justify-between items-center">
                <div>
                  <p className="robot-pin text-lg mb-1">{lobby.pin}</p>
                  <p className="text-sm text-gray-400">
                    Players: {lobby.players.length}/{lobby.maxPlayers}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setPinInput(lobby.pin);
                    joinLobbyByPin();
                  }}
                  disabled={lobby.players.length >= lobby.maxPlayers || lobby.started}
                  className="robot-button bg-gradient-to-r from-green-500 to-green-600 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Join
                </button>
              </div>
            </div>
          ))}
          {lobbies.length === 0 && (
            <p className="text-gray-400 text-center py-4">No lobbies available</p>
          )}
        </div>
      </div>
    </div>
  );
}

// LobbyRoom Component
function LobbyRoom() {
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const navigate = useNavigate();
  const socket = useSocket();
  const playerName = localStorage.getItem('playerName') || '';

  useEffect(() => {
    if (!socket || !lobbyId) return;

    socket.emit('getLobby', { lobbyId });

    socket.on('lobbyData', (data: Lobby) => {
      setLobby(data);
      setStarted(data.started);
    });

    socket.on('lobbyUpdated', (data: Lobby) => {
      setLobby(data);
    });

    socket.on('lobbyStarted', () => {
      setStarted(true);
    });

    socket.on('lobbyError', (error: string) => {
      setError(error);
      setTimeout(() => {
        navigate('/');
      }, 3000);
    });

    return () => {
      socket.off('lobbyData');
      socket.off('lobbyUpdated');
      socket.off('lobbyStarted');
      socket.off('lobbyError');
    };
  }, [socket, lobbyId, navigate]);

  const startLobby = () => {
    if (socket && lobbyId) {
      socket.emit('startLobby', { lobbyId });
    }
  };

  const leaveLobby = () => {
    if (socket && lobbyId) {
      socket.emit('leaveLobby', { lobbyId });
      navigate('/');
    }
  };

  if (error) {
    return (
      <div className="container mx-auto p-4">
        <div className="robot-card p-6 rounded-lg bg-red-900/20 border border-red-500/20">
          <strong className="font-bold text-red-400">Error: </strong>
          <span className="text-red-300">{error}</span>
        </div>
      </div>
    );
  }

  if (!lobby) {
    return (
      <div className="container mx-auto p-4 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="loading-spinner w-12 h-12 rounded-full mb-4"></div>
          <span className="text-gray-400">Loading lobby...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 min-h-screen">
      <div className="robot-card p-6 rounded-lg">
        <h1 className="text-4xl font-bold mb-6 robot-title">Game Lobby</h1>
        
        <div className="mb-8 p-6 robot-card rounded-lg">
          <h2 className="text-2xl font-semibold mb-4">Lobby Pin</h2>
          <div className="robot-pin text-4xl text-center mb-2">
            {lobby.pin}
          </div>
          <p className="text-gray-400 text-center">
            Share this pin with your friends to join the game
          </p>
        </div>

        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Players ({lobby.players.length}/{lobby.maxPlayers})</h2>
          <div className="player-list">
            {lobby.players.map((player) => (
              <div 
                key={player.id} 
                className={`player-item ${player.name === playerName ? 'player-item-self' : ''}`}
              >
                <span className="status-indicator"></span>
                {player.name}
                {player.name === playerName && (
                  <span className="ml-2 text-xs text-blue-400">(You)</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-4">
          {!lobby.started && (
            <button
              onClick={startLobby}
              className="robot-button flex-1 bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-3 rounded-lg font-semibold"
            >
              Start Game
            </button>
          )}
          {lobby.started && (
            <div className="flex-1 bg-green-900/20 text-green-400 px-6 py-3 rounded-lg font-semibold text-center border border-green-500/20">
              Game Started!
            </div>
          )}
          <button
            onClick={leaveLobby}
            className="robot-button flex-1 bg-gradient-to-r from-red-500 to-red-600 text-white px-6 py-3 rounded-lg font-semibold"
          >
            Leave Lobby
          </button>
        </div>
      </div>
    </div>
  );
}

// App Component
function App() {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    console.log('Initializing socket connection...');
    const newSocket = io('http://localhost:3000', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    newSocket.on('connect', () => {
      console.log('Socket connected successfully. Socket ID:', newSocket.id);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected. Reason:', reason);
    });

    setSocket(newSocket);

    return () => {
      console.log('Cleaning up socket connection...');
      newSocket.close();
    };
  }, []);

  return (
    <SocketContext.Provider value={socket}>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lobby/:lobbyId" element={<LobbyRoom />} />
        </Routes>
      </Router>
    </SocketContext.Provider>
  );
}

export default App; 