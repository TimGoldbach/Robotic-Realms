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
  playerCards: Map<string, number[]>; // Maps player ID to their cards
  availableCards: number[]; // Cards that haven't been dealt yet
  currentPlayerId: string | null;
  discardPile: number[];
}

interface Player {
  id: string;
  name: string;
}

const lobbies: Map<string, Lobby> = new Map();

// Initialize the deck of 52 cards
const DECK = Array.from({ length: 52 }, (_, i) => i + 1);

function generateUniquePin(): string {
  let pin: string;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while ([...lobbies.values()].some(lobby => lobby.pin === pin));
  return pin;
}

function dealCards(lobby: Lobby) {
  // Reset available cards and player cards
  lobby.availableCards = [...DECK];
  lobby.playerCards = new Map();
  lobby.discardPile = [];
  lobby.currentPlayerId = lobby.players[0]?.id || null;

  // Deal 7 cards to each player
  lobby.players.forEach(player => {
    const playerCards: number[] = [];
    for (let i = 0; i < 7; i++) {
      if (lobby.availableCards.length > 0) {
        const randomIndex = Math.floor(Math.random() * lobby.availableCards.length);
        const card = lobby.availableCards.splice(randomIndex, 1)[0];
        playerCards.push(card);
      }
    }
    lobby.playerCards.set(player.id, playerCards);
  });
}

function nextTurn(lobby: Lobby) {
  const currentIndex = lobby.players.findIndex(p => p.id === lobby.currentPlayerId);
  const nextIndex = (currentIndex + 1) % lobby.players.length;
  lobby.currentPlayerId = lobby.players[nextIndex].id;
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
      started: false,
      playerCards: new Map(),
      availableCards: [],
      currentPlayerId: null,
      discardPile: []
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
      // Remove player's cards
      lobby.playerCards.delete(socket.id);
      // Remove player from players list
      lobby.players = lobby.players.filter(p => p.id !== socket.id);
      
      if (lobby.players.length === 0) {
        console.log('Deleting empty lobby');
        lobbies.delete(lobbyId);
      } else {
        // If the game was started, set it back to not started
        if (lobby.started) {
          lobby.started = false;
          lobby.availableCards = [];
          lobby.playerCards = new Map();
        }
        socket.leave(lobbyId);
        io.to(lobbyId).emit('lobbyUpdated', lobby);
      }
      io.emit('lobbyList', Array.from(lobbies.values()));
    }
  });

  socket.on('startLobby', ({ lobbyId }: { lobbyId: string }) => {
    console.log('Starting lobby:', lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (lobby && !lobby.started) {
      lobby.started = true;
      dealCards(lobby);
      io.to(lobbyId).emit('lobbyStarted');
      io.to(lobbyId).emit('lobbyUpdated', lobby);
      // Send each player their cards
      lobby.players.forEach(player => {
        const playerCards = lobby.playerCards.get(player.id) || [];
        io.to(player.id).emit('dealCards', { cards: playerCards });
      });
    }
  });

  socket.on('getLobby', ({ lobbyId }: { lobbyId: string }) => {
    console.log('Getting lobby data:', lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (lobby) {
      // Don't send other players' cards
      const lobbyData = {
        ...lobby,
        playerCards: new Map([...lobby.playerCards].map(([id, cards]) => [
          id,
          id === socket.id ? cards : []
        ]))
      };
      socket.emit('lobbyData', lobbyData);
    } else {
      socket.emit('lobbyError', 'Lobby not found');
    }
  });

  socket.on('getLobbies', () => {
    console.log('Getting lobby list');
    socket.emit('lobbyList', Array.from(lobbies.values()));
  });

  socket.on('drawFromDeck', ({ lobbyId }) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby) {
      socket.emit('lobbyError', 'Lobby not found');
      return;
    }

    if (socket.id !== lobby.currentPlayerId) {
      socket.emit('lobbyError', 'Not your turn');
      return;
    }

    if (lobby.availableCards.length === 0) {
      socket.emit('lobbyError', 'No cards left in deck');
      return;
    }

    // Draw a random card from the available cards
    const randomIndex = Math.floor(Math.random() * lobby.availableCards.length);
    const drawnCard = lobby.availableCards[randomIndex];
    
    // Remove the drawn card from available cards
    lobby.availableCards.splice(randomIndex, 1);
    
    // Add the card to the player's hand
    const playerCards = lobby.playerCards.get(socket.id) || [];
    playerCards.push(drawnCard);
    lobby.playerCards.set(socket.id, playerCards);

    // Broadcast the updated lobby state
    io.to(lobbyId).emit('lobbyUpdated', lobby);
  });

  socket.on('drawFromDiscard', ({ lobbyId }: { lobbyId: string }) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby || !lobby.started || lobby.currentPlayerId !== socket.id || lobby.discardPile.length === 0) {
      socket.emit('lobbyError', 'Invalid move');
      return;
    }

    const card = lobby.discardPile.pop()!;
    const playerCards = lobby.playerCards.get(socket.id) || [];
    playerCards.push(card);
    lobby.playerCards.set(socket.id, playerCards);
    
    io.to(lobbyId).emit('lobbyUpdated', lobby);
    io.to(socket.id).emit('dealCards', { cards: playerCards });
  });

  socket.on('discardCard', ({ lobbyId, cardIndex }: { lobbyId: string, cardIndex: number }) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby || !lobby.started || lobby.currentPlayerId !== socket.id) {
      socket.emit('lobbyError', 'Invalid move');
      return;
    }

    const playerCards = lobby.playerCards.get(socket.id) || [];
    if (cardIndex >= 0 && cardIndex < playerCards.length) {
      const card = playerCards.splice(cardIndex, 1)[0];
      lobby.discardPile.push(card);
      lobby.playerCards.set(socket.id, playerCards);
      
      // Move to next player's turn
      nextTurn(lobby);
      
      io.to(lobbyId).emit('lobbyUpdated', lobby);
      io.to(socket.id).emit('dealCards', { cards: playerCards });
    }
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