import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

interface Lobby {
  id: string;
  pin: string;
  players: Player[];
  maxPlayers: number;
  started: boolean;
}

interface Player {
  id: string;
  name: string;
}

const lobbies: Map<string, Lobby> = new Map();

function generateUniquePin(): string {
  let pin: string;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while ([...lobbies.values()].some(lobby => lobby.pin === pin));
  return pin;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createLobby', ({ playerName }: { playerName: string }) => {
    console.log('Creating lobby for player:', playerName);
    const pin = generateUniquePin();
    const lobby: Lobby = {
      id: uuidv4(),
      pin,
      players: [{ id: socket.id, name: playerName }],
      maxPlayers: 6,
      started: false
    };
    console.log('Created lobby:', lobby);
    lobbies.set(lobby.id, lobby);
    socket.join(lobby.id);
    socket.emit('lobbyCreated', lobby);
    io.emit('lobbyList', Array.from(lobbies.values()));
  });

  socket.on('joinLobby', ({ pin, playerName }: { pin: string, playerName: string }) => {
    console.log('Joining lobby with pin:', pin, 'player:', playerName);
    const lobby = Array.from(lobbies.values()).find(l => l.pin === pin);
    if (!lobby) {
      console.log('Lobby not found');
      socket.emit('lobbyError', 'Lobby not found');
      return;
    }
    if (lobby.started) {
      console.log('Game already started');
      socket.emit('lobbyError', 'Game already started');
      return;
    }
    if (lobby.players.length >= lobby.maxPlayers) {
      console.log('Lobby is full');
      socket.emit('lobbyError', 'Lobby is full');
      return;
    }
    if (lobby.players.some(p => p.name === playerName)) {
      console.log('Name already taken');
      socket.emit('lobbyError', 'Name already taken');
      return;
    }

    console.log('Adding player to lobby');
    lobby.players.push({ id: socket.id, name: playerName });
    socket.join(lobby.id);
    socket.emit('lobbyJoined', lobby);
    io.to(lobby.id).emit('lobbyUpdated', lobby);
    io.emit('lobbyList', Array.from(lobbies.values()));
  });

  socket.on('leaveLobby', ({ lobbyId }: { lobbyId: string }) => {
    console.log('Leaving lobby:', lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (lobby) {
      lobby.players = lobby.players.filter(p => p.id !== socket.id);
      if (lobby.players.length === 0) {
        console.log('Deleting empty lobby');
        lobbies.delete(lobbyId);
      }
      socket.leave(lobbyId);
      io.to(lobbyId).emit('lobbyUpdated', lobby);
      io.emit('lobbyList', Array.from(lobbies.values()));
    }
  });

  socket.on('startLobby', ({ lobbyId }: { lobbyId: string }) => {
    console.log('Starting lobby:', lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (lobby && !lobby.started) {
      lobby.started = true;
      io.to(lobbyId).emit('lobbyStarted');
      io.to(lobbyId).emit('lobbyUpdated', lobby);
    }
  });

  socket.on('getLobby', ({ lobbyId }: { lobbyId: string }) => {
    console.log('Getting lobby data:', lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (lobby) {
      socket.emit('lobbyData', lobby);
    } else {
      socket.emit('lobbyError', 'Lobby not found');
    }
  });

  socket.on('getLobbies', () => {
    console.log('Getting lobby list');
    socket.emit('lobbyList', Array.from(lobbies.values()));
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Clean up lobbies when player disconnects
    lobbies.forEach((lobby, lobbyId) => {
      if (lobby.players.some(player => player.id === socket.id)) {
        lobby.players = lobby.players.filter(player => player.id !== socket.id);
        if (lobby.players.length === 0) {
          lobbies.delete(lobbyId);
        } else {
          io.to(lobbyId).emit('lobbyUpdated', lobby);
        }
        io.emit('lobbyList', Array.from(lobbies.values()));
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 