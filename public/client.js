// public/client.js
const socket = io();

let myId = null;
let myRoom = null;
let currentPhase = 'waiting';
let isHost = false;
let myAssignedWord = null; // 내 단어 저장

const loginScreen = document.getElementById('login-screen');
const waitingScreen = document.getElementById('waiting-screen');
const wordInputScreen = document.getElementById('word-input-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');

const nicknameInput = document.getElementById('nicknameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const wordInput = document.getElementById('wordInput');
const systemMessageAreaWaiting = document.getElementById('system-message-area-waiting');
const systemMessageAreaGame = document.getElementById('system-message-area-game');
const waitingPlayerListEl = document.getElementById('waiting-player-list');
const othersWordsListEl = document.getElementById('others-words-list');
const finalWordsListEl = document.getElementById('final-words-list');

const joinBtn = document.getElementById('joinBtn');
const submitWordBtn = document.getElementById('submitWordBtn');
const checkAnswerBtn = document.getElementById('checkAnswerBtn');
const endGameBtn = document.getElementById('endGameBtn');
const restartBtn = document.getElementById('restartBtn');

// --- 초기화 ---
function initializeUI() {
    loginScreen.classList.remove('hidden');
    waitingScreen.classList.add('hidden');
    wordInputScreen.classList.add('hidden');
    gameScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
}
socket.on('connect', initializeUI);

// --- 이벤트 리스너 ---

joinBtn.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    const codeStr = roomCodeInput.value.trim().toUpperCase();
    if (!nickname || !codeStr) { alert('닉네임과 방 코드(인원포함)를 입력해주세요.'); return; }
    socket.emit('joinRoom', { nickname, codeStr });
});

submitWordBtn.addEventListener('click', () => {
    const word = wordInput.value.trim();
    if (!word) { alert('단어를 입력해주세요.'); return; }
    socket.emit('submitWord', { roomCode: myRoom, playerId: myId, word });
    submitWordBtn.disabled = true;
    wordInput.disabled = true;
    submitWordBtn.textContent = "제출 완료 (다른 플레이어 대기 중...)";
});

checkAnswerBtn.addEventListener('click', () => {
    if (confirm('정말로 정답을 확인하시겠습니까? (확인 후 게임이 종료될 수 있습니다.)')) {
        alert(`당신의 단어는 '${myAssignedWord}'입니다!`);
        checkAnswerBtn.disabled = true;
        checkAnswerBtn.textContent = `내 단어: ${myAssignedWord} (확인 완료)`;
    }
});

endGameBtn.addEventListener('click', () => {
    if (confirm('게임을 종료하고 모든 플레이어의 단어를 공개하시겠습니까?')) {
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
    document.getElementById('currentRoomCode').textContent = myRoom;
    document.getElementById('gameRoomCode').textContent = myRoom;
    document.getElementById('totalPlayers').textContent = data.totalPlayers;
    loginScreen.classList.add('hidden');
    waitingScreen.classList.remove('hidden');
});

socket.on('systemMessage', (msg) => {
    if (currentPhase === 'waiting') systemMessageAreaWaiting.textContent = msg;
    else systemMessageAreaGame.textContent = msg;
});

socket.on('errorMsg', (msg) => alert(msg));

socket.on('gameStateUpdate', (data) => {
    currentPhase = data.phase;
    document.getElementById('currentPlayers').textContent = data.players.length;
    
    if (data.phase === 'waiting') {
        updateWaitingPlayerList(data.players);
        resultScreen.classList.add('hidden'); // 재시작 시 결과 화면 숨김
    }

    // 방장 여부 업데이트 및 종료 버튼 표시
    const hostPlayer = data.players[0]; // 임시: 첫 번째 플레이어를 방장으로 가정 (서버 hostId 구현 필요)
    isHost = (hostPlayer && hostPlayer.id === myId);
    if (isHost && data.phase === 'playing') endGameBtn.classList.remove('hidden');
    else endGameBtn.classList.add('hidden');

    if (data.phase === 'ended') {
        gameScreen.classList.add('hidden');
        resultScreen.classList.remove('hidden');
    }
});

// 단어 입력 시작
socket.on('wordInputStart', (data) => {
    waitingScreen.classList.add('hidden');
    wordInputScreen.classList.remove('hidden');
    document.getElementById('input-topic').textContent = data.topic;
    document.getElementById('next-player-nickname').textContent = data.nextPlayerNickname;
});

// 게임 시작 (단어 목록 수신)
socket.on('gameStarted', (data) => {
    wordInputScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    document.getElementById('game-topic').textContent = data.topic;
    document.getElementById('myNickname').textContent = nicknameInput.value;
    myAssignedWord = data.myWord; // 내 단어 저장

    othersWordsListEl.innerHTML = '';
    data.othersWords.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="nickname">${p.nickname}</span>의 단어: <span class="word">${p.word}</span>`;
        othersWordsListEl.appendChild(li);
    });
});

// 게임 종료 (전체 단어 공개)
socket.on('gameOver', (data) => {
    finalWordsListEl.innerHTML = '';
    data.allWords.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="nickname">${p.nickname}</span>의 단어: <span class="word">${p.word}</span>`;
        finalWordsListEl.appendChild(li);
    });
});

// --- UI 헬퍼 함수 ---

function updateWaitingPlayerList(players) {
    waitingPlayerListEl.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.nickname;
        if (p.submitted) {
             const submittedMark = document.createElement('span');
             submittedMark.className = 'submitted-mark';
             submittedMark.textContent = '(입력 완료)';
             li.appendChild(submittedMark);
        }
        waitingPlayerListEl.appendChild(li);
    });
}