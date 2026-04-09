// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const { v4: uuidv4 } = require('uuid');
const wordData = require('./wordList');

app.use(express.static('public'));

const rooms = {};

// 방 코드 파싱 함수 (이전과 동일)
function parseRoomCode(codeStr) {
    const parts = codeStr.split('-');
    if (parts.length !== 2) return null;
    const totalPlayers = parseInt(parts[1]);
    if (isNaN(totalPlayers) || totalPlayers < 2) return null; // 최소 2명
    return { code: parts[0].toUpperCase(), totalPlayers: totalPlayers };
}

// 게임 데이터 초기화
function resetGameData(room) {
    room.topic = null;
    Object.values(room.players).forEach(p => {
        p.submittedWord = null; // 내가 입력한 단어
        p.assignedWord = null;  // 나에게 할당된 단어 (내 이마의 단어)
    });
}

// 게임 시작 (단어 입력 단계로 이동)
function startGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // 1. 주제 선정
    const topics = Object.keys(wordData);
    room.topic = topics[Math.floor(Math.random() * topics.length)];

    // 2. 상태 변경 및 플레이어 순서 결정
    room.phase = 'wordInput';
    const playerIds = Object.keys(room.players);
    // 플레이어 순서를 섞어서 다음 사람 지정 (옵션)
    // for (let i = playerIds.length - 1; i > 0; i--) {
    //     const j = Math.floor(Math.random() * (i + 1));
    //     [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    // }

    // 3. 각 플레이어에게 다음 사람 정보 전송
    playerIds.forEach((pid, index) => {
        const nextPlayerId = playerIds[(index + 1) % playerIds.length];
        const nextPlayer = room.players[nextPlayerId];
        io.to(room.players[pid].socketId).emit('wordInputStart', {
            topic: room.topic,
            nextPlayerNickname: nextPlayer.nickname
        });
    });

    io.to(roomCode).emit('systemMessage', `주제는 '${room.topic}'입니다. 다음 사람의 단어를 입력해주세요.`);
    updateGameState(roomCode);
}

// 모든 단어 입력 완료 후 게임 화면으로 이동
function proceedToGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.phase = 'playing';
    const playerIds = Object.keys(room.players);

    // 단어 순환 할당 (A 입력 -> B 할당, B 입력 -> C 할당, ...)
    playerIds.forEach((pid, index) => {
        const nextPlayerId = playerIds[(index + 1) % playerIds.length];
        room.players[nextPlayerId].assignedWord = room.players[pid].submittedWord;
    });

    // 각 플레이어에게 게임 정보 전송 (내 단어 제외)
    playerIds.forEach(pid => {
        const otherPlayersWords = playerIds
            .filter(id => id !== pid) // 나 자신 제외
            .map(id => ({ nickname: room.players[id].nickname, word: room.players[id].assignedWord }));
        
        io.to(room.players[pid].socketId).emit('gameStarted', {
            topic: room.topic,
            othersWords: otherPlayersWords,
            myWord: room.players[pid].assignedWord // 정답 확인용 (클라이언트에서 숨김 처리)
        });
    });

    io.to(roomCode).emit('systemMessage', '모든 단어가 입력되었습니다! 게임을 시작합니다.');
    updateGameState(roomCode);
}

// 상태 업데이트
function updateGameState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const playerList = Object.values(room.players).map(p => ({
        id: p.id, nickname: p.nickname, submitted: !!p.submittedWord // 입력 여부 전송
    }));
    io.to(roomCode).emit('gameStateUpdate', {
        phase: room.phase,
        players: playerList,
        totalPlayers: room.totalPlayers
    });
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ nickname, codeStr }) => {
        const settings = parseRoomCode(codeStr);
        if (!settings) { socket.emit('errorMsg', '잘못된 방 코드 형식입니다.'); return; }
        const roomCode = settings.code;

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                players: {}, phase: 'waiting', topic: null,
                totalPlayers: settings.totalPlayers, hostId: null
            };
            console.log(`Room ${roomCode} created.`);
        }
        const room = rooms[roomCode];

        if (room.phase !== 'waiting') { socket.emit('errorMsg', '이미 게임이 시작되었습니다.'); return; }
        if (Object.keys(room.players).length >= room.totalPlayers) { socket.emit('errorMsg', '방이 꽉 찼습니다.'); return; }

        const playerId = uuidv4();
        room.players[playerId] = { id: playerId, socketId: socket.id, nickname: nickname, submittedWord: null, assignedWord: null };
        if (!room.hostId) room.hostId = playerId;
        socket.join(roomCode);

        socket.emit('joined', { playerId, roomCode, nickname, totalPlayers: room.totalPlayers });
        io.to(roomCode).emit('systemMessage', `${nickname}님이 입장하셨습니다.`);
        updateGameState(roomCode);

        if (Object.keys(room.players).length === room.totalPlayers) {
            resetGameData(room);
            startGame(roomCode);
        }
    });

    // 단어 제출 처리
    socket.on('submitWord', ({ roomCode, playerId, word }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'wordInput') return;
        if (!room.players[playerId] || room.players[playerId].submittedWord) return;

        room.players[playerId].submittedWord = word;
        updateGameState(roomCode); // 입력 상태 업데이트

        // 모든 플레이어가 입력했는지 확인
        const allSubmitted = Object.values(room.players).every(p => p.submittedWord);
        if (allSubmitted) {
            proceedToGame(roomCode);
        }
    });

    // 게임 종료 및 정답 공개 (방장 전용)
    socket.on('endGameBtn', ({ roomCode, playerId }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'playing') return;
        if (playerId !== room.hostId) return; // 방장 확인

        room.phase = 'ended';
        // 모든 플레이어의 단어 정보 전송
        const allWords = Object.values(room.players).map(p => ({ nickname: p.nickname, word: p.assignedWord }));
        io.to(roomCode).emit('gameOver', { allWords });
        updateGameState(roomCode);
    });

    // 재시작
    socket.on('restartGame', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'ended') return;
        room.phase = 'waiting';
        resetGameData(room);
        updateGameState(roomCode);
        io.to(roomCode).emit('systemMessage', '게임이 초기화되었습니다. 새로운 플레이어를 기다립니다.');
    });

    socket.on('disconnect', () => {
        // ... (기존 방장 승계 로직 포함)
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            for (const playerId in room.players) {
                if (room.players[playerId].socketId === socket.id) {
                    const leavingPlayerNickname = room.players[playerId].nickname;
                    const wasHost = room.hostId === playerId;
                    delete room.players[playerId];
                    if (Object.keys(room.players).length === 0) {
                        delete rooms[roomCode]; console.log(`Room ${roomCode} deleted.`);
                    } else {
                        if (wasHost) {
                            room.hostId = Object.keys(room.players)[0];
                            io.to(roomCode).emit('systemMessage', `${leavingPlayerNickname}님이 퇴장하여 ${room.players[room.hostId].nickname}님이 방장이 되었습니다.`);
                        } else {
                            io.to(roomCode).emit('systemMessage', `${leavingPlayerNickname}님이 퇴장하셨습니다.`);
                        }
                        updateGameState(roomCode);
                    }
                    return;
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Yang Se-chan Game Server running on port ${PORT}`); });