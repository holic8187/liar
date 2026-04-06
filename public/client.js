// public/client.js
const socket = io();

let myId = null;
let myRoom = null;
let currentPhase = 'waiting';
let selectedTargetId = null;
// === [추가] 선택된 플레이어 닉네임 저장 변수 ===
let selectedNickname = null;
// ============================================
let isSpectator = false;

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
const spectatorInfoArea = document.getElementById('spectator-info-area');
const phaseStatus = document.getElementById('phase-status');

const joinBtn = document.getElementById('joinBtn');
const votePhaseBtn = document.getElementById('votePhaseBtn');
const voteBtn = document.getElementById('voteBtn');
const restartBtn = document.getElementById('restartBtn');

// --- 이벤트 리스너 ---

joinBtn.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    const codeStr = roomCodeInput.value.trim().toUpperCase();
    if (!nickname || !codeStr) { alert('닉네임과 방 코드(인원포함)를 입력해주세요.'); return; }
    socket.emit('joinRoom', { nickname, codeStr });
});

votePhaseBtn.addEventListener('click', () => {
    if (confirm('모든 플레이어가 힌트 설명을 마쳤나요? 투표를 시작합니다.')) {
        socket.emit('startVoting', { roomCode: myRoom });
    }
});

voteBtn.addEventListener('click', () => {
    if (!selectedTargetId) return;
    // === [수정] 선택된 닉네임으로 확인 메시지 표시 ===
    if (confirm(`'${selectedNickname}'님을 라이어로 지목하시겠습니까? (변경 불가)`)) {
        socket.emit('submitVote', { roomCode: myRoom, playerId: myId, targetId: selectedTargetId });
        voteBtn.disabled = true;
        voteBtn.textContent = "투표 완료 (결과 대기 중...)"; // 버튼 텍스트 변경
    }
    // ==============================================
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
    document.getElementById('totalPlayers').textContent = data.totalPlayers;
    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    isSpectator = false;
});

socket.on('spectatorJoined', (data) => {
    // ... (관전자 입장 처리 로직 이전과 동일)
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
    document.getElementById('currentPlayers').textContent = data.players.length;
    updateUIByPhase(data.phase);
    updatePlayerListUI(data.players);
});

socket.on('gameStarted', (data) => {
    if (isSpectator) return;

    secretInfoArea.classList.remove('hidden');
    spectatorInfoArea.classList.add('hidden');

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
    // 버튼 텍스트는 voteBtn 클릭 이벤트에서 이미 변경됨
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

    if (isSpectator) return;

    if (phase === 'waiting') {
        secretInfoArea.classList.add('hidden');
    } else if (phase === 'playing') {
        votePhaseBtn.classList.remove('hidden');
    } else if (phase === 'voting') {
        voteBtn.classList.remove('hidden');
        voteBtn.disabled = true;
        // === [수정] 투표 버튼 초기 텍스트 설정 ===
        voteBtn.textContent = "선택한 플레이어에게 투표하기";
        // ======================================
        playerListEl.classList.add('voting-phase');
    }
}

function updatePlayerListUI(players) {
    playerListEl.innerHTML = '';
    selectedTargetId = null;
    selectedNickname = null; // 초기화

    players.forEach(p => {
        // === [수정] 자기 자신은 리스트에서 제외 ===
        if (p.id === myId) return; 
        // ====================================

        const li = document.createElement('li');
        li.textContent = p.nickname;
        li.dataset.id = p.id;

        if (p.voted) {
            const votedMark = document.createElement('span');
            votedMark.className = 'voted-mark';
            votedMark.textContent = '(투표 완료)';
            li.appendChild(votedMark);
        }

        if (!isSpectator && currentPhase === 'voting' && !p.voted) {
            li.addEventListener('click', () => {
                document.querySelectorAll('#player-list li').forEach(el => el.classList.remove('selected'));
                li.classList.add('selected');
                selectedTargetId = p.id;
                // === [추가] 선택된 닉네임 저장 및 버튼 텍스트 업데이트 ===
                selectedNickname = p.nickname;
                voteBtn.disabled = false;
                voteBtn.textContent = `'${selectedNickname}'님에게 투표하기`;
                // ===================================================
            });
        }
        playerListEl.appendChild(li);
    });
}