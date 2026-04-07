// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const { v4: uuidv4 } = require('uuid');
const wordData = require('./wordList');

app.use(express.static('public'));

const rooms = {};

// 게임 데이터 초기화
function resetGameData(room) {
    room.liarId = null;
    room.topic = null;
    room.citizenWord = null; // 시민용 단어
    room.liarWord = null;    // 라이어용 단어
    // 투표 관련 데이터 제거
}

// 게임 시작 및 역할/단어 분배
function startGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // 1. 주제 선정
    const topics = Object.keys(wordData);
    room.topic = topics[Math.floor(Math.random() * topics.length)];
    const words = wordData[room.topic];

    // 2. 서로 다른 두 단어 선정 (시민용, 라이어용)
    let citizenWordIndex = Math.floor(Math.random() * words.length);
    let liarWordIndex = Math.floor(Math.random() * words.length);
    while (liarWordIndex === citizenWordIndex) { // 같으면 다시 뽑기
        liarWordIndex = Math.floor(Math.random() * words.length);
    }
    room.citizenWord = words[citizenWordIndex];
    room.liarWord = words[liarWordIndex];

    // 3. 라이어 1명 랜덤 선정
    const playerIds = Object.keys(room.players);
    room.liarId = playerIds[Math.floor(Math.random() * playerIds.length)];

    // 4. 상태 변경 및 정보 전송
    room.phase = 'playing';
    
    playerIds.forEach(pid => {
        const player = room.players[pid];
        const isLiar = pid === room.liarId;
        // 개인별 비밀 정보 전송 (라이어 여부는 안 보냄)
        io.to(player.socketId).emit('gameStarted', {
            topic: room.topic,
            word: isLiar ? room.liarWord : room.citizenWord
        });
    });

    io.to(roomCode).emit('systemMessage', '게임이 시작되었습니다! 제시어를 확인하고 외부 채팅방에서 힌트를 진행해주세요.');
    updateGameState(roomCode);
}

// === [추가] 게임 종료 및 결과 공개 함수 ===
function endGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.phase = 'ended';
    io.to(roomCode).emit('gameOver', {
        citizenWord: room.citizenWord,
        liarWord: room.liarWord,
        liarName: room.players[room.liarId].nickname
    });
    updateGameState(roomCode);
}
// ======================================

// 상태 업데이트 (투표 정보 제거)
function updateGameState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const playerList = Object.values(room.players).map(p => ({ id: p.id, nickname: p.nickname }));
    io.to(roomCode).emit('gameStateUpdate', {
        phase: room.phase,
        players: playerList,
        hostId: room.hostId // 방장 정보 추가 전송
    });
}

// 방 코드 파싱 함수 (이전과 동일)
function parseRoomCode(codeStr) {
    const parts = codeStr.split('-');
    if (parts.length !== 2) return null;
    const totalPlayers = parseInt(parts[1]);
    if (isNaN(totalPlayers) || totalPlayers < 3) return null; 
    return {
        code: parts[0].toUpperCase(),
        totalPlayers: totalPlayers
    };
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ nickname, codeStr }) => {
        const settings = parseRoomCode(codeStr);
        if (!settings) { socket.emit('errorMsg', '잘못된 방 코드 형식입니다.'); return; }
        const roomCode = settings.code;
        const totalPlayersStr = settings.totalPlayers;

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                players: {}, phase: 'waiting',
                liarId: null, topic: null, citizenWord: null, liarWord: null,
                totalPlayers: totalPlayersStr,
                hostId: null // 방장 ID 저장
            };
            console.log(`Room ${roomCode} created.`);
        }
        const room = rooms[roomCode];

        // 관전자 처리 (투표 정보 제거)
        if (room.phase !== 'waiting' && room.phase !== 'ended') {
            socket.emit('spectatorJoined', {
                roomCode: roomCode, nickname: nickname,
                topic: room.topic, phase: room.phase,
                players: Object.values(room.players).map(p => ({ id: p.id, nickname: p.nickname })),
                hostId: room.hostId
            });
            return;
        }

        if (Object.keys(room.players).length >= room.totalPlayers) { socket.emit('errorMsg', '방이 꽉 찼습니다.'); return; }

        const playerId = uuidv4();
        room.players[playerId] = { id: playerId, socketId: socket.id, nickname: nickname };
        
        // 첫 번째 플레이어를 방장으로 설정
        if (!room.hostId) {
            room.hostId = playerId;
        }

        socket.join(roomCode);
        socket.emit('joined', { playerId, roomCode, nickname, totalPlayers: room.totalPlayers, hostId: room.hostId });
        io.to(roomCode).emit('systemMessage', `${nickname}님이 입장하셨습니다.`);
        updateGameState(roomCode);

        if (Object.keys(room.players).length === room.totalPlayers) {
            resetGameData(room);
            startGame(roomCode);
        }
    });

    // === [추가] 게임 종료 요청 (방장만 가능) ===
    socket.on('endGameBtn', ({ roomCode, playerId }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'playing') return;
        if (playerId !== room.hostId) return; // 방장 확인
        endGame(roomCode);
    });
    // ==========================================

    // 투표 관련 이벤트 핸들러 제거됨 (startVoting, submitVote)

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
        // ... (기존 접속 종료 처리 로직 - 방장 승계 로직은 복잡해지므로 생략)
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            for (const playerId in room.players) {
                if (room.players[playerId].socketId === socket.id) {
                    io.to(roomCode).emit('systemMessage', `${room.players[playerId].nickname}님이 퇴장하셨습니다.`);
                    delete room.players[playerId];
                    if (Object.keys(room.players).length === 0) {
                        delete rooms[roomCode];
                    } else {
                        updateGameState(roomCode);
                    }
                    return;
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Liar Game Server running on port ${PORT}`); });