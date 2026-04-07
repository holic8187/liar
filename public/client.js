// public/client.js
const socket = io(); // <--- ⭐ 이 줄이 핵심적으로 빠져있었습니다! ⭐

let myId = null;
let myRoom = null;
let currentPhase = 'waiting';
let isSpectator = false;
let isHost = false; // 방장 여부

const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');
const nicknameInput = document.getElementById('nicknameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const systemMessageArea = document.getElementById('system-message-area');
const playerListEl = document.getElementById('player-list');
const secretInfoArea = document.getElementById('secret-info-area');
const spectatorInfoArea = document.getElementById('spectator-info-area');
const phaseStatus = document.getElementById('phase-status');

const joinBtn = document.getElementById('joinBtn');
const endGameBtn = document.getElementById('endGameBtn');
const restartBtn = document.getElementById('restartBtn');

// --- 이벤트 리스너 ---

joinBtn.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    const codeStr = roomCodeInput.value.trim().toUpperCase();
    if (!nickname || !codeStr) { alert('닉네임과 방 코드(인원포함)를 입력해주세요.'); return; }
    socket.emit('joinRoom', { nickname, codeStr });
});

// 게임 종료 버튼 (방장 전용)
endGameBtn.addEventListener('click', () => {
    if (confirm('게임을 종료하고 정답을 공개하시겠습니까?')) {
        socket.emit('endGameBtn', { roomCode: myRoom, playerId: myId });
    }
});

restartBtn.addEventListener('click', () => {
    socket.emit('restartGame', { roomCode: myRoom });
    resultScreen.classList.add('hidden');
});

// --- 소켓 이벤트 핸들러 ---

socket.on('joined', (data) => {
    myId = data.playerId;
    myRoom = data.roomCode;
    isHost = data.hostId === myId; // 방장 여부 확인
    document.getElementById('currentRoomCode').textContent = myRoom;
    document.getElementById('myNickname').textContent = data.nickname;
    document.getElementById('totalPlayers').textContent = data.totalPlayers;
    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    isSpectator = false;
});

socket.on('spectatorJoined', (data) => {
    isHost = data.hostId === myId;
    myRoom = data.roomCode;
    document.getElementById('currentRoomCode').textContent = myRoom;
    document.getElementById('myNickname').textContent = data.nickname + " (관전자)";
    document.getElementById('totalPlayers').textContent = "-";
    
    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    isSpectator = true;

    secretInfoArea.classList.add('hidden');
    spectatorInfoArea.classList.remove('hidden');
    document.getElementById('topic-spectator').textContent = data.topic;

    currentPhase = data.phase;
    updateUIByPhase(data.phase);
    updatePlayerListUI(data.players);
    systemMessageArea.textContent = "게임 진행 중 입장하여 관전 모드입니다.";
});

socket.on('systemMessage', (msg) => {
    systemMessageArea.textContent = msg;
});

socket.on('errorMsg', (msg) => alert(msg));

socket.on('gameStateUpdate', (data) => {
    currentPhase = data.phase;
    isHost = data.hostId === myId; // 방장 정보 업데이트
    document.getElementById('currentPlayers').textContent = data.players.length;
    updateUIByPhase(data.phase);
    updatePlayerListUI(data.players);
});

// 게임 시작 (역할 구분 없이 단어 표시)
socket.on('gameStarted', (data) => {
    if (isSpectator) return;

    secretInfoArea.classList.remove('hidden');
    spectatorInfoArea.classList.add('hidden');

    document.getElementById('topic-display').textContent = data.topic;
    document.getElementById('word-display').textContent = data.word;
});

// 게임 종료 (결과 공개)
socket.on('gameOver', (data) => {
    resultScreen.classList.remove('hidden');
    document.getElementById('winner-title').textContent = "결과 공개!";
    
    document.getElementById('reveal-citizen-word').textContent = data.citizenWord;
    document.getElementById('reveal-liar-word').textContent = data.liarWord;
    document.getElementById('reveal-liar-name').textContent = data.liarName;
    
    secretInfoArea.classList.add('hidden');
    spectatorInfoArea.classList.add('hidden');
    updateUIByPhase('ended');
});

// --- UI 헬퍼 함수 ---

function updateUIByPhase(phase) {
    const phaseTexts = { waiting: '대기 중', playing: '진행 중', ended: '결과 확인 중' };
    phaseStatus.textContent = `(${phaseTexts[phase]})`;

    document.querySelectorAll('.action-btn').forEach(btn => btn.classList.add('hidden'));

    if (isSpectator) return;

    if (phase === 'waiting') {
        secretInfoArea.classList.add('hidden');
    } else if (phase === 'playing') {
        // 방장에게만 종료 버튼 표시
        if (isHost) {
            endGameBtn.classList.remove('hidden');
        }
    }
}

function updatePlayerListUI(players) {
    playerListEl.innerHTML = '';

    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.nickname;
        li.dataset.id = p.id;
        if (p.id === myId) li.classList.add('my-player-li');

        // 방장 표시 (서버에서 받아온 hostId와 비교)
        if (p.id === isHost) { 
             const hostMark = document.createElement('span');
             hostMark.className = 'host-mark';
             hostMark.textContent = '(방장)';
             li.appendChild(hostMark);
        }
        
        playerListEl.appendChild(li);
    });
}