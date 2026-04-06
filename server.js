// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
// === [수정] CORS 설정 추가 (온라인 플레이 필수) ===
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
// ===============================================
const { v4: uuidv4 } = require('uuid');
const wordData = require('./wordList');

app.use(express.static('public'));

const rooms = {};
// 최소 인원 설정은 방 코드에서 파싱하므로 제거

// 게임 데이터 초기화
function resetGameData(room) {
    room.liarId = null;
    room.topic = null;
    room.word = null;
    room.votes = {}; // { voterId: targetId }
    Object.values(room.players).forEach(p => p.voted = false);
}

// 게임 시작 및 역할 분배
function startGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // 1. 주제와 단어 랜덤 선정
    const topics = Object.keys(wordData);
    room.topic = topics[Math.floor(Math.random() * topics.length)];
    const words = wordData[room.topic];
    room.word = words[Math.floor(Math.random() * words.length)];

    // 2. 라이어 1명 랜덤 선정
    const playerIds = Object.keys(room.players);
    room.liarId = playerIds[Math.floor(Math.random() * playerIds.length)];

    // 3. 상태 변경 및 정보 전송
    room.phase = 'playing';
    
    playerIds.forEach(pid => {
        const player = room.players[pid];
        const isLiar = pid === room.liarId;
        // 개인별 비밀 정보 전송
        io.to(player.socketId).emit('gameStarted', {
            isLiar: isLiar,
            topic: room.topic,
            word: isLiar ? null : room.word // 라이어에게는 단어 미전송
        });
    });

    io.to(roomCode).emit('systemMessage', '모든 플레이어가 입장하여 게임이 시작되었습니다! 제시어를 확인하세요.');
    updateGameState(roomCode);
}

// 투표 결과 처리
function processVotes(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const totalPlayers = Object.keys(room.players).length;
    const votesNeeded = Math.floor(totalPlayers / 2) + 1;

    const voteCounts = {};
    for (const targetId of Object.values(room.votes)) {
        voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    }

    let maxVotes = 0;
    let eliminatedId = null;
    
    for (const [targetId, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
            maxVotes = count;
            eliminatedId = targetId;
        } else if (count === maxVotes) {
            eliminatedId = null; // 동점
        }
    }

    let winner = '';
    let resultMessage = '';

    if (eliminatedId && maxVotes >= votesNeeded && eliminatedId === room.liarId) {
        winner = 'citizen';
        resultMessage = `시민 승리! 라이어는 [${room.players[room.liarId].nickname}]님이었습니다.`;
    } else {
        winner = 'liar';
        const liarName = room.players[room.liarId].nickname;
        resultMessage = `라이어 승리! [${liarName}]님이 시민들을 속였습니다.`;
    }

    room.phase = 'ended';
    io.to(roomCode).emit('gameOver', {
        winner: winner,
        message: resultMessage,
        liarName: room.players[room.liarId].nickname,
        word: room.word
    });
    updateGameState(roomCode);
}

// 상태 업데이트
function updateGameState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const playerList = Object.values(room.players).map(p => ({ id: p.id, nickname: p.nickname, voted: p.voted }));
    io.to(roomCode).emit('gameStateUpdate', {
        phase: room.phase,
        players: playerList
    });
}

// === [추가] 방 코드 파싱 함수 ===
function parseRoomCode(codeStr) {
    const parts = codeStr.split('-');
    if (parts.length !== 2) return null;
    const totalPlayers = parseInt(parts[1]);
    if (isNaN(totalPlayers) || totalPlayers < 3) return null; // 최소 3명
    return {
        code: parts[0].toUpperCase(),
        totalPlayers: totalPlayers
    };
}
// ==============================

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ nickname, codeStr }) => {
        // === [수정] 방 코드 파싱 및 유효성 검사 ===
        const settings = parseRoomCode(codeStr);
        if (!settings) {
            socket.emit('errorMsg', '잘못된 방 코드 형식입니다. (예: ROOM1-5, 최소 3명)');
            return;
        }
        const roomCode = settings.code;
        const totalPlayersStr = settings.totalPlayers;
        // ========================================

        // 방이 없으면 생성
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                players: {}, phase: 'waiting',
                liarId: null, topic: null, word: null, votes: {},
                totalPlayers: totalPlayersStr // 총인원 저장
            };
            console.log(`Room ${roomCode} created for ${totalPlayersStr} players.`);
        }
        const room = rooms[roomCode];

        // === [수정] 게임 중 난입 시 관전자 처리 ===
        if (room.phase !== 'waiting' && room.phase !== 'ended') {
            // 관전자 정보 전송 (주제는 보여주되 단어는 숨김)
            socket.emit('spectatorJoined', {
                roomCode: roomCode,
                nickname: nickname,
                topic: room.topic,
                phase: room.phase,
                players: Object.values(room.players).map(p => ({ id: p.id, nickname: p.nickname, voted: p.voted }))
            });
            return;
        }
        // ========================================

        // 방이 꽉 찼는지 확인
        if (Object.keys(room.players).length >= room.totalPlayers) {
            socket.emit('errorMsg', '방이 이미 꽉 찼습니다.');
            return;
        }

        const playerId = uuidv4();
        room.players[playerId] = { id: playerId, socketId: socket.id, nickname: nickname, voted: false };
        socket.join(roomCode);

        socket.emit('joined', { playerId, roomCode, nickname, totalPlayers: room.totalPlayers });
        io.to(roomCode).emit('systemMessage', `${nickname}님이 입장하셨습니다. (${Object.keys(room.players).length}/${room.totalPlayers})`);
        updateGameState(roomCode);

        // === [추가] 인원이 다 차면 자동 시작 ===
        if (Object.keys(room.players).length === room.totalPlayers) {
            resetGameData(room);
            startGame(roomCode);
        }
        // ====================================
    });

    // (방장 수동 시작 버튼은 자동 시작으로 대체되어 제거됨)

    // 투표 단계 시작 요청
    socket.on('startVoting', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'playing') return;
        room.phase = 'voting';
        io.to(roomCode).emit('systemMessage', '힌트 단계가 종료되었습니다. 라이어를 투표해주세요!');
        updateGameState(roomCode);
    });

    // 투표 행사
    socket.on('submitVote', ({ roomCode, playerId, targetId }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'voting') return;
        if (!room.players[playerId] || room.players[playerId].voted) return;

        room.votes[playerId] = targetId;
        room.players[playerId].voted = true;
        socket.emit('voteConfirmed');
        updateGameState(roomCode);

        const totalPlayers = Object.keys(room.players).length;
        const votedPlayers = Object.values(room.players).filter(p => p.voted).length;

        if (votedPlayers === totalPlayers) {
            processVotes(roomCode);
        }
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
        // (접속 종료 처리 로직 이전과 동일)
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