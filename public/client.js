// public/client.js
const socket = io();

let myId = null;
let myRoom = null;
let currentPhase = 'waiting';
let selectedTargetId = null;
let isSpectator = false; // 관전자 여부

const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');
const nicknameInput = document.getElementById('nicknameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const systemMessageArea = document.getElementById('system-message-area');
const playerListEl = document.getElementById('player-list');
const secretInfoArea = document.getElementById('secret-info-area');
const citizenCard = document.getElementById('citizen-card');
const liarCard = document.getElementById('liar-card');
const spectatorInfoArea = document.getElementById('spectator-info-area'); // 추가
const phaseStatus = document.getElementById('phase-status');

const joinBtn = document.getElementById('joinBtn');
// startBtn 제거됨
const votePhaseBtn = document.getElementById('votePhaseBtn');
const voteBtn = document.getElementById('voteBtn');
const restartBtn = document.getElementById('restartBtn');

// --- 이벤트 리스너 ---

joinBtn.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    // === [수정] 방 코드 문자열 그대로 전송 ===
    const codeStr = roomCodeInput.value.trim().toUpperCase();
    if (!nickname || !codeStr) { alert('닉네임과 방 코드(인원포함)를 입력해주세요.'); return; }
    socket.emit('joinRoom', { nickname, codeStr });
});

// (startBtn 이벤트 리스너 제거됨)

votePhaseBtn.addEventListener('click', () => {
    if (confirm('모든 플레이어가 힌트 설명을 마쳤나요? 투표를 시작합니다.')) {
        socket.emit('startVoting', { roomCode: myRoom });
    }
});

voteBtn.addEventListener('click', () => {
    if (!selectedTargetId) return;
    if (confirm('선택한 플레이어를 라이어로 지목하시겠습니까? (변경 불가)')) {
        socket.emit('submitVote', { roomCode: myRoom, playerId: myId, targetId: selectedTargetId });
        voteBtn.disabled = true;
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
    document.getElementById('currentRoomCode').textContent = myRoom;
    document.getElementById('myNickname').textContent = data.nickname;
    document.getElementById('totalPlayers').textContent = data.totalPlayers; // 총인원 표시
    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    isSpectator = false;
});

// === [추가] 관전자 입장 처리 ===
socket.on('spectatorJoined', (data) => {
    myRoom = data.roomCode;
    document.getElementById('currentRoomCode').textContent = myRoom;
    document.getElementById('myNickname').textContent = data.nickname + " (관전자)";
    document.getElementById('totalPlayers').textContent = "-";
    
    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    isSpectator = true;

    // 관전자 UI 표시
    secretInfoArea.classList.add('hidden');
    spectatorInfoArea.classList.remove('hidden');
    document.getElementById('topic-spectator').textContent = data.topic;

    // 현재 게임 상태 업데이트
    currentPhase = data.phase;
    updateUIByPhase(data.phase);
    updatePlayerListUI(data.players);
    systemMessageArea.textContent = "게임 진행 중 입장하여 관전 모드입니다.";
});
// ============================

socket.on('systemMessage', (msg) => {
    systemMessageArea.textContent = msg;
});

socket.on('errorMsg', (msg) => alert(msg));

socket.on('gameStateUpdate', (data) => {
    currentPhase = data.phase;
    // === [추가] 현재 인원수 업데이트 ===
    document.getElementById('currentPlayers').textContent = data.players.length;
    updateUIByPhase(data.phase);
    updatePlayerListUI(data.players);
});

socket.on('gameStarted', (data) => {
    if (isSpectator) return; // 관전자는 무시

    secretInfoArea.classList.remove('hidden');
    spectatorInfoArea.classList.add('hidden'); // 혹시 모르니 숨김

    if (data.isLiar) {
        citizenCard.classList.add('hidden');
        liarCard.classList.remove('hidden');
        document.getElementById('topic-liar').textContent = data.topic;
    } else {
        liarCard.classList.add('hidden');
        citizenCard.classList.remove('hidden');
        document.getElementById('topic-citizen').textContent = data.topic;
        document.getElementById('word-citizen').textContent = data.word;
    }
});

socket.on('voteConfirmed', () => {
    alert('투표가 완료되었습니다. 다른 플레이어들을 기다려주세요.');
    playerListEl.classList.remove('voting-phase');
});

socket.on('gameOver', (data) => {
    resultScreen.classList.remove('hidden');
    const titleEl = document.getElementById('winner-title');
    if (data.winner === 'citizen') {
        titleEl.textContent = "🎉 시민 승리! 🎉";
        titleEl.className = 'citizen-win-title';
    } else {
        titleEl.textContent = "😈 라이어 승리! 😈";
        titleEl.className = 'liar-win-title';
    }
    document.getElementById('result-message').textContent = data.message;
    document.getElementById('reveal-liar').textContent = data.liarName;
    document.getElementById('reveal-word').textContent = data.word;
    
    secretInfoArea.classList.add('hidden');
    spectatorInfoArea.classList.add('hidden');
    updateUIByPhase('ended');
});

// --- UI 헬퍼 함수 ---

function updateUIByPhase(phase) {
    const phaseTexts = { waiting: '대기 중', playing: '힌트 진행 중', voting: '투표 중', ended: '결과 확인 중' };
    phaseStatus.textContent = `(${phaseTexts[phase]})`;

    document.querySelectorAll('.action-btn').forEach(btn => btn.classList.add('hidden'));

    // 관전자는 모든 조작 버튼 숨김
    if (isSpectator) return;

    if (phase === 'waiting') {
        // 자동 시작이므로 시작 버튼 없음
        secretInfoArea.classList.add('hidden');
    } else if (phase === 'playing') {
        votePhaseBtn.classList.remove('hidden');
    } else if (phase === 'voting') {
        voteBtn.classList.remove('hidden');
        voteBtn.disabled = true;
        playerListEl.classList.add('voting-phase');
    }
}

function updatePlayerListUI(players) {
    playerListEl.innerHTML = '';
    selectedTargetId = null;

    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.nickname;
        li.dataset.id = p.id;
        if (p.id === myId) li.classList.add('my-player-li');

        if (p.voted) {
            const votedMark = document.createElement('span');
            votedMark.className = 'voted-mark';
            votedMark.textContent = '(투표 완료)';
            li.appendChild(votedMark);
        }

        // 관전자는 투표 클릭 이벤트 없음
        if (!isSpectator && currentPhase === 'voting' && p.id !== myId && !p.voted) {
            li.addEventListener('click', () => {
                document.querySelectorAll('#player-list li').forEach(el => el.classList.remove('selected'));
                li.classList.add('selected');
                selectedTargetId = p.id;
                voteBtn.disabled = false;
            });
        }
        playerListEl.appendChild(li);
    });
}