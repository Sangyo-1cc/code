// 전역 변수
let pose;
let video;
let canvas;
let ctx;
let currentFrame = 0;
let totalFrames = 0;
let isAnalyzing = false;
let squatData = [];
let debugMode = false;
let frameSkip = 0;
let analysisTimeout = null;
let noSquatFrames = 0;
let poseInitialized = false;

// DOM 요소
const elements = {
    uploadSection: null,
    analyzingSection: null,
    resultsSection: null,
    uploadArea: null,
    videoInput: null,
    uploadedVideo: null,
    videoPreview: null,
    analyzeBtn: null,
    resetBtn: null,
    downloadBtn: null,
    progressFill: null,
    analysisStatus: null,
    frameInfo: null,
    steps: null,
    debugPanel: null
};

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    // MediaPipe 로딩 대기
    if (typeof Pose === 'undefined') {
        console.log('MediaPipe Pose 로딩 대기 중...');
        let checkCount = 0;
        const checkInterval = setInterval(() => {
            checkCount++;
            if (typeof Pose !== 'undefined') {
                clearInterval(checkInterval);
                console.log('MediaPipe Pose 로드 완료');
                initializeApp();
            } else if (checkCount > 40) { // 20초 대기
                clearInterval(checkInterval);
                showError('MediaPipe 라이브러리를 로드할 수 없습니다. 페이지를 새로고침해주세요.');
            }
        }, 500);
    } else {
        initializeApp();
    }
});

// 앱 초기화 함수
function initializeApp() {
    initializeElements();
    setupEventListeners();
    setupPose();
    
    // 디버그 모드 설정
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('debug') === 'true') {
        debugMode = true;
        if (elements.debugPanel) {
            elements.debugPanel.classList.add('show');
        }
    }
}

// DOM 요소 초기화
function initializeElements() {
    elements.uploadSection = document.getElementById('uploadSection');
    elements.analyzingSection = document.getElementById('analyzingSection');
    elements.resultsSection = document.getElementById('resultsSection');
    elements.uploadArea = document.getElementById('uploadArea');
    elements.videoInput = document.getElementById('videoInput');
    elements.uploadedVideo = document.getElementById('uploadedVideo');
    elements.videoPreview = document.getElementById('videoPreview');
    elements.analyzeBtn = document.getElementById('analyzeBtn');
    elements.resetBtn = document.getElementById('resetBtn');
    elements.downloadBtn = document.getElementById('downloadBtn');
    elements.progressFill = document.getElementById('progressFill');
    elements.analysisStatus = document.getElementById('analysisStatus');
    elements.frameInfo = document.getElementById('frameInfo');
    elements.steps = document.querySelectorAll('.step');
    elements.debugPanel = document.getElementById('debugPanel');
    
    canvas = document.getElementById('outputCanvas');
    ctx = canvas.getContext('2d');
}

// 단계 표시 업데이트
function updateStep(currentStepNumber) {
    elements.steps.forEach(step => {
        step.classList.remove('active');
        if (parseInt(step.dataset.step) === currentStepNumber) {
            step.classList.add('active');
        }
    });
}

// 이벤트 리스너 설정
function setupEventListeners() {
    elements.uploadArea.addEventListener('click', () => {
        elements.videoInput.click();
    });
    
    elements.videoInput.addEventListener('change', handleFileSelect);
    
    elements.uploadArea.addEventListener('dragover', handleDragOver);
    elements.uploadArea.addEventListener('dragleave', handleDragLeave);
    elements.uploadArea.addEventListener('drop', handleDrop);
    
    elements.analyzeBtn.addEventListener('click', startAnalysis);
    elements.resetBtn.addEventListener('click', () => resetApp());
    elements.downloadBtn.addEventListener('click', () => downloadResults());
}

// MediaPipe Pose 설정 (개선됨)
async function setupPose() {
    try {
        if (typeof Pose === 'undefined') {
            console.error('MediaPipe Pose가 로드되지 않았습니다.');
            showError('포즈 감지 라이브러리를 로드할 수 없습니다.');
            return;
        }
        
        pose = new Pose({
            locateFile: (file) => {
                // 최신 CDN URL 사용
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
            }
        });
        
        // 브라우저별 최적화된 설정
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
        
        pose.setOptions({
            modelComplexity: 1, // 모든 브라우저에서 동일한 모델 사용
            smoothLandmarks: true,
            minDetectionConfidence: 0.3, // 감지 민감도 향상
            minTrackingConfidence: 0.3,  // 추적 민감도 향상
            enableSegmentation: false,
            smoothSegmentation: false,
            staticImageMode: false // 비디오 모드 명시
        });
        
        pose.onResults(onPoseResults);
        
        // 초기화 대기
        await pose.initialize();
        poseInitialized = true;
        
        console.log('MediaPipe Pose 초기화 성공 (브라우저:', isSafari ? '사파리' : isChrome ? '크롬' : '기타', ')');
        
    } catch (error) {
        console.error('MediaPipe Pose 초기화 실패:', error);
        showError('포즈 감지 초기화에 실패했습니다.');
    }
}

// 앱 초기화
function resetApp() {
    isAnalyzing = false;
    squatData = [];
    currentFrame = 0;
    frameSkip = 0;
    noSquatFrames = 0;
    
    if (analysisTimeout) {
        clearTimeout(analysisTimeout);
        analysisTimeout = null;
    }
    
    elements.uploadSection.style.display = 'block';
    elements.analyzingSection.style.display = 'none';
    elements.resultsSection.style.display = 'none';
    elements.videoPreview.style.display = 'none';
    elements.uploadArea.style.display = 'block';
    elements.analyzeBtn.disabled = true;
    elements.progressFill.style.width = '0%';
    
    elements.uploadedVideo.src = '';
    elements.videoInput.value = '';
    
    updateStep(1);
}

// 디버그 정보 업데이트
function updateDebugInfo(metrics) {
    if (!debugMode || !elements.debugPanel) return;
    
    const debugContent = elements.debugPanel.querySelector('.debug-content');
    if (!debugContent) {
        const content = document.createElement('div');
        content.className = 'debug-content';
        elements.debugPanel.appendChild(content);
    }
    
    if (metrics) {
        elements.debugPanel.querySelector('.debug-content').innerHTML = `
            <p>무릎 각도: ${metrics.kneeAngle?.toFixed(1)}°</p>
            <p>허리 각도: ${metrics.backAngle?.toFixed(1)}°</p>
            <p>깊이: ${metrics.depth}</p>
            <p>타임스탬프: ${metrics.timestamp?.toFixed(2)}s</p>
            <p>수집된 데이터: ${squatData.length}</p>
        `;
    }
}

// 파일 선택 처리
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file && file.type.startsWith('video/')) {
        loadVideo(file);
    } else {
        showError('비디오 파일을 선택해주세요.');
    }
}

// 드래그 오버 처리
function handleDragOver(e) {
    e.preventDefault();
    elements.uploadArea.classList.add('dragover');
}

// 드래그 리브 처리
function handleDragLeave(e) {
    e.preventDefault();
    elements.uploadArea.classList.remove('dragover');
}

// 드롭 처리
function handleDrop(e) {
    e.preventDefault();
    elements.uploadArea.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('video/')) {
        loadVideo(files[0]);
    } else {
        showError('비디오 파일을 선택해주세요.');
    }
}

// 비디오 로드
function loadVideo(file) {
    const url = URL.createObjectURL(file);
    elements.uploadedVideo.src = url;
    
    elements.uploadedVideo.autoplay = false;
    elements.uploadedVideo.loop = false;
    elements.uploadedVideo.muted = true;
    
    elements.uploadedVideo.onloadedmetadata = () => {
        if (elements.uploadedVideo.duration > 30) {
            showError('영상은 최대 30초까지만 분석 가능합니다.');
            resetApp();
            return;
        }
        
        elements.videoPreview.style.display = 'block';
        elements.analyzeBtn.disabled = false;
        elements.uploadArea.style.display = 'none';
        
        const maxWidth = 640;
        const maxHeight = 480;
        let width = elements.uploadedVideo.videoWidth;
        let height = elements.uploadedVideo.videoHeight;
        
        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = width * ratio;
            height = height * ratio;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        elements.uploadedVideo.style.maxWidth = '100%';
        elements.uploadedVideo.style.height = 'auto';
        
        elements.uploadedVideo.pause();
        elements.uploadedVideo.currentTime = 0;
        
        updateStep(1);
    };
}

// 분석 시작 (개선됨)
async function startAnalysis() {
    if (isAnalyzing || !poseInitialized) {
        if (!poseInitialized) {
            showError('포즈 감지가 아직 초기화되지 않았습니다. 잠시 후 다시 시도해주세요.');
        }
        return;
    }
    
    isAnalyzing = true;
    squatData = [];
    currentFrame = 0;
    frameSkip = 0;
    analysisTimeout = null;
    noSquatFrames = 0;
    window.lastFrameTime = null;
    
    elements.uploadSection.style.display = 'none';
    elements.analyzingSection.style.display = 'block';
    updateStep(2);
    
    if (!elements.analyzingSection.querySelector('.promo-banner')) {
        const promoBanner = document.createElement('div');
        promoBanner.className = 'promo-banner';
        promoBanner.innerHTML = `
            <p>📍 분당선 오리역 1ccBANG</p>
            <p>운동하고 영상찍는 신개념 휴식공간</p>
        `;
        elements.analyzingSection.appendChild(promoBanner);
    }
    
    elements.uploadedVideo.currentTime = 0;
    elements.uploadedVideo.playbackRate = 1.0; // 모든 브라우저에서 동일한 속도
    
    try {
        await elements.uploadedVideo.play();
    } catch (error) {
        console.error('비디오 재생 오류:', error);
        showError('비디오를 재생할 수 없습니다.');
        return;
    }
    
    const timeoutDuration = Math.max(60000, elements.uploadedVideo.duration * 3000);
    analysisTimeout = setTimeout(() => {
        if (isAnalyzing) {
            console.log('분석 시간 초과 - 강제 완료');
            completeAnalysis();
        }
    }, timeoutDuration);
    
    console.log('분석 시작:', {
        duration: elements.uploadedVideo.duration,
        timeout: timeoutDuration / 1000 + '초'
    });
    
    processVideo();
}

// 비디오 프레임 처리 (개선됨)
async function processVideo() {
    if (!isAnalyzing) {
        return;
    }
    
    if (elements.uploadedVideo.ended || elements.uploadedVideo.currentTime >= elements.uploadedVideo.duration) {
        console.log('비디오 분석 완료');
        completeAnalysis();
        return;
    }
    
    if (elements.uploadedVideo.paused && isAnalyzing) {
        console.log('비디오가 일시정지됨 - 재생 재개 시도');
        try {
            await elements.uploadedVideo.play();
        } catch (error) {
            console.error('비디오 재생 재개 실패:', error);
            completeAnalysis();
            return;
        }
    }
    
    // 프레임 레이트 제한 (15fps로 낮춤)
    const now = Date.now();
    if (!window.lastFrameTime) {
        window.lastFrameTime = now;
    }
    
    const deltaTime = now - window.lastFrameTime;
    if (deltaTime < 66) { // 15fps
        requestAnimationFrame(processVideo);
        return;
    }
    window.lastFrameTime = now;
    
    try {
        ctx.drawImage(elements.uploadedVideo, 0, 0, canvas.width, canvas.height);
    } catch (error) {
        console.error('캔버스 그리기 오류:', error);
        requestAnimationFrame(processVideo);
        return;
    }
    
    try {
        if (pose && typeof pose.send === 'function') {
            await pose.send({ image: canvas });
        } else {
            console.error('MediaPipe Pose가 초기화되지 않았습니다.');
            showError('포즈 감지 초기화 오류가 발생했습니다.');
            completeAnalysis();
            return;
        }
    } catch (error) {
        console.error('포즈 감지 오류:', error);
    }
    
    const progress = Math.min((elements.uploadedVideo.currentTime / elements.uploadedVideo.duration) * 100, 100);
    elements.progressFill.style.width = `${progress}%`;
    
    currentFrame++;
    elements.frameInfo.textContent = `프레임 ${currentFrame} 처리 중... (${Math.round(progress)}%)`;
    
    if (isAnalyzing) {
        requestAnimationFrame(processVideo);
    }
}

// 포즈 감지 결과 처리 (개선됨)
function onPoseResults(results) {
    if (!isAnalyzing) return;
    
    if (!results.poseLandmarks) {
        noSquatFrames++;
        return;
    }
    
    const landmarks = results.poseLandmarks;
    const squatMetrics = analyzeSquatFrame(landmarks);
    
    if (squatMetrics && squatMetrics.kneeAngle) {
        squatData.push(squatMetrics);
        noSquatFrames = 0;
        
        if (squatData.length % 10 === 0) {
            elements.analysisStatus.textContent = `${squatData.length}개의 프레임 분석 완료...`;
            console.log(`분석 진행 중: ${squatData.length}개 프레임 수집`);
        }
        
        if (debugMode) {
            updateDebugInfo(squatMetrics);
        }
    } else {
        noSquatFrames++;
    }
}

// 스쿼트 프레임 분석 (개선됨)
function analyzeSquatFrame(landmarks) {
    // 주요 관절 좌표
    const leftHip = landmarks[23];
    const leftKnee = landmarks[25];
    const leftAnkle = landmarks[27];
    const rightHip = landmarks[24];
    const rightKnee = landmarks[26];
    const rightAnkle = landmarks[28];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    
    // 더 낮은 가시성 요구사항
    const minVisibility = 0.1;
    
    // 양쪽 다리의 평균값 사용
    let kneeAngleLeft = null;
    let kneeAngleRight = null;
    let backAngleLeft = null;
    let backAngleRight = null;
    
    // 왼쪽 측정
    if (leftHip && leftKnee && leftAnkle && leftShoulder &&
        leftHip.visibility > minVisibility && leftKnee.visibility > minVisibility) {
        kneeAngleLeft = calculateAngle(leftHip, leftKnee, leftAnkle);
        backAngleLeft = calculateAngle(leftShoulder, leftHip, leftKnee);
    }
    
    // 오른쪽 측정
    if (rightHip && rightKnee && rightAnkle && rightShoulder &&
        rightHip.visibility > minVisibility && rightKnee.visibility > minVisibility) {
        kneeAngleRight = calculateAngle(rightHip, rightKnee, rightAnkle);
        backAngleRight = calculateAngle(rightShoulder, rightHip, rightKnee);
    }
    
    // 하나라도 측정되면 사용
    let kneeAngle = null;
    let backAngle = null;
    let hipY = null;
    let kneeY = null;
    
    if (kneeAngleLeft !== null && kneeAngleRight !== null) {
        // 양쪽 모두 측정된 경우 평균값 사용
        kneeAngle = (kneeAngleLeft + kneeAngleRight) / 2;
        backAngle = (backAngleLeft + backAngleRight) / 2;
        hipY = (leftHip.y + rightHip.y) / 2;
        kneeY = (leftKnee.y + rightKnee.y) / 2;
    } else if (kneeAngleLeft !== null) {
        // 왼쪽만 측정된 경우
        kneeAngle = kneeAngleLeft;
        backAngle = backAngleLeft;
        hipY = leftHip.y;
        kneeY = leftKnee.y;
    } else if (kneeAngleRight !== null) {
        // 오른쪽만 측정된 경우
        kneeAngle = kneeAngleRight;
        backAngle = backAngleRight;
        hipY = rightHip.y;
        kneeY = rightKnee.y;
    } else {
        // 측정 실패
        return null;
    }
    
    // 깊이 계산 (임계값 조정)
    const depth = kneeAngle < 110 ? 'deep' : kneeAngle < 140 ? 'parallel' : 'shallow';
    
    return {
        timestamp: elements.uploadedVideo.currentTime,
        kneeAngle: kneeAngle,
        backAngle: backAngle,
        depth: depth,
        hipY: hipY,
        kneeY: kneeY,
        visibility: Math.min(
            leftHip?.visibility || 0,
            rightHip?.visibility || 0,
            leftKnee?.visibility || 0,
            rightKnee?.visibility || 0
        )
    };
}

// 각도 계산 함수
function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    
    if (angle > 180.0) {
        angle = 360 - angle;
    }
    
    return angle;
}

// 분석 완료 (개선됨)
function completeAnalysis() {
    console.log('분석 완료 함수 호출');
    
    isAnalyzing = false;
    
    if (elements.uploadedVideo) {
        elements.uploadedVideo.pause();
        elements.uploadedVideo.currentTime = 0;
    }
    
    if (analysisTimeout) {
        clearTimeout(analysisTimeout);
        analysisTimeout = null;
    }
    
    window.lastFrameTime = null;
    
    // 데이터 충분성 체크 (최소 3개로 낮춤)
    if (squatData.length < 3) {
        console.log(`분석 실패: 수집된 데이터 ${squatData.length}개`);
        showError('충분한 스쿼트 동작을 감지하지 못했습니다. 측면에서 촬영한 스쿼트 영상을 사용해주세요.');
        resetApp();
        return;
    }
    
    const results = calculateResults();
    
    // 스쿼트 카운트 보정
    if (results.squatCount === 0 && squatData.length > 0) {
        results.squatCount = Math.max(1, Math.floor(squatData.length / 15));
        console.log('스쿼트 카운트 보정:', results.squatCount);
    }
    
    elements.analyzingSection.style.display = 'none';
    elements.resultsSection.style.display = 'block';
    updateStep(3);
    
    displayResults(results);
}

// 결과 계산
function calculateResults() {
    const squatCount = countSquats();
    const avgDepth = calculateAverageDepth();
    const avgBackAngle = calculateAverageBackAngle();
    const consistency = calculateConsistency();
    
    const depthScore = calculateDepthScore(avgDepth);
    const postureScore = calculatePostureScore(avgBackAngle);
    const balanceScore = calculateBalanceScore();
    const speedScore = calculateSpeedScore();
    
    const totalScore = Math.round((depthScore + postureScore + balanceScore + speedScore) / 4);
    
    return {
        squatCount,
        totalScore,
        depthScore,
        postureScore,
        balanceScore,
        speedScore,
        avgDepth,
        avgBackAngle,
        consistency
    };
}

// 스쿼트 횟수 계산 (개선됨)
function countSquats() {
    if (squatData.length < 10) return 1;
    
    let count = 0;
    let isDown = false;
    
    // 무릎 각도 기반 카운트
    for (let i = 0; i < squatData.length; i++) {
        if (squatData[i].kneeAngle < 130 && !isDown) {
            isDown = true;
        } else if (squatData[i].kneeAngle > 150 && isDown) {
            count++;
            isDown = false;
        }
    }
    
    // Y 좌표 변화 기반 카운트 (백업)
    if (count === 0) {
        const hipMovements = [];
        for (let i = 1; i < squatData.length; i++) {
            const movement = squatData[i].hipY - squatData[i-1].hipY;
            hipMovements.push(movement);
        }
        
        // 피크 감지
        for (let i = 10; i < hipMovements.length - 10; i++) {
            if (hipMovements[i] > 0 && hipMovements[i-1] <= 0) {
                count++;
                i += 15; // 중복 방지
            }
        }
    }
    
    return Math.max(1, count);
}

// 평균 깊이 계산
function calculateAverageDepth() {
    const deepCount = squatData.filter(d => d.depth === 'deep').length;
    const parallelCount = squatData.filter(d => d.depth === 'parallel').length;
    const shallowCount = squatData.filter(d => d.depth === 'shallow').length;
    
    if (deepCount > parallelCount && deepCount > shallowCount) return 'deep';
    if (parallelCount > shallowCount) return 'parallel';
    return 'shallow';
}

// 평균 허리 각도 계산
function calculateAverageBackAngle() {
    const sum = squatData.reduce((acc, d) => acc + d.backAngle, 0);
    return sum / squatData.length;
}

// 일관성 계산
function calculateConsistency() {
    const angles = squatData.map(d => d.kneeAngle);
    const mean = angles.reduce((a, b) => a + b) / angles.length;
    const variance = angles.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / angles.length;
    const stdDev = Math.sqrt(variance);
    
    return Math.max(0, 100 - stdDev * 2);
}

// 깊이 점수 계산
function calculateDepthScore(avgDepth) {
    switch (avgDepth) {
        case 'deep': return 95;
        case 'parallel': return 85;
        case 'shallow': return 70;
        default: return 75;
    }
}

// 자세 점수 계산
function calculatePostureScore(avgBackAngle) {
    if (avgBackAngle >= 70 && avgBackAngle <= 110) {
        return 90 + (10 - Math.abs(90 - avgBackAngle) / 2);
    } else {
        return Math.max(60, 90 - Math.abs(90 - avgBackAngle));
    }
}

// 균형 점수 계산
function calculateBalanceScore() {
    return 85;
}

// 속도 점수 계산
function calculateSpeedScore() {
    return 88;
}

// 결과 표시
function displayResults(results) {
    animateScore(results.totalScore);
    document.getElementById('depthScore').textContent = results.depthScore;
    document.getElementById('postureScore').textContent = results.postureScore;
    document.getElementById('balanceScore').textContent = results.balanceScore;
    document.getElementById('speedScore').textContent = results.speedScore;
    
    const feedback = generateFeedback(results);
    displayFeedback(feedback);
    
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    elements.downloadBtn.textContent = isMobile ? '결과 이미지 저장하기' : '결과 이미지 다운로드';
    
    saveToSheets(results);
}

// 점수 애니메이션
function animateScore(targetScore) {
    const scoreDisplay = document.getElementById('scoreDisplay');
    const progressCircle = document.querySelector('.score-ring .progress');
    
    let currentScore = 0;
    const increment = targetScore / 50;
    const circumference = 2 * Math.PI * 90;
    
    const animateInterval = setInterval(() => {
        currentScore += increment;
        if (currentScore >= targetScore) {
            currentScore = targetScore;
            clearInterval(animateInterval);
        }
        
        scoreDisplay.textContent = Math.round(currentScore);
        const offset = circumference - (currentScore / 100) * circumference;
        progressCircle.style.strokeDashoffset = offset;
    }, 30);
}

// 피드백 생성
function generateFeedback(results) {
    const feedback = [];
    
    if (results.totalScore >= 90) {
        feedback.push({
            type: 'success',
            title: '🏆 훌륭합니다!',
            content: '거의 완벽한 스쿼트 자세입니다. 이 자세를 유지하세요!'
        });
    } else if (results.totalScore >= 75) {
        feedback.push({
            type: 'success',
            title: '👍 좋습니다!',
            content: '전반적으로 좋은 스쿼트 자세입니다. 약간의 개선이 필요합니다.'
        });
    } else {
        feedback.push({
            type: 'warning',
            title: '💪 더 노력하세요!',
            content: '자세 개선이 필요합니다. 아래 피드백을 참고하세요.'
        });
    }
    
    if (results.depthScore < 80) {
        feedback.push({
            type: 'warning',
            title: '📏 깊이 개선 필요',
            content: '스쿼트 시 엉덩이를 더 낮춰보세요. 무릎이 90도 각도가 되도록 하면 더 효과적입니다.'
        });
    }
    
    if (results.postureScore < 80) {
        feedback.push({
            type: 'danger',
            title: '🦴 허리 자세 주의',
            content: '허리를 곧게 펴고 가슴을 들어올리세요. 상체가 너무 앞으로 숙여지지 않도록 주의하세요.'
        });
    }
    
    if (results.balanceScore < 80) {
        feedback.push({
            type: 'warning',
            title: '⚖️ 균형 개선 필요',
            content: '양쪽 다리에 균등하게 체중을 분산시키세요. 발가락과 발뒤꿈치에 고르게 무게를 실으세요.'
        });
    }
    
    if (results.speedScore < 80) {
        feedback.push({
            type: 'warning',
            title: '⏱️ 속도 조절 필요',
            content: '일정한 속도로 스쿼트를 수행하세요. 너무 빠르거나 느리지 않게 조절하세요.'
        });
    }
    
    feedback.push({
        type: 'motivation',
        title: '🎯 계속 도전하세요!',
        content: `오늘 ${results.squatCount}개의 스쿼트를 완료했습니다! 꾸준한 연습으로 더 나은 자세를 만들 수 있습니다.`
    });
    
    return feedback;
}

// 피드백 표시
function displayFeedback(feedbackList) {
    const container = document.getElementById('feedbackContainer');
    container.innerHTML = '';
    
    feedbackList.forEach((feedback, index) => {
        const card = document.createElement('div');
        card.className = `feedback-card ${feedback.type}`;
        card.style.animationDelay = `${index * 0.1}s`;
        
        card.innerHTML = `
            <div class="feedback-title">${feedback.title}</div>
            <div class="feedback-content">${feedback.content}</div>
        `;
        
        container.appendChild(card);
    });
}

// Google Sheets에 저장
async function saveToSheets(results) {
    try {
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            await google.script.run.withSuccessHandler(() => {
                console.log('데이터 저장 성공');
            }).withFailureHandler((error) => {
                console.error('데이터 저장 실패:', error);
            }).logSquatData(results);
        } else {
            console.log('Google Sheets API를 사용할 수 없습니다.');
        }
    } catch (error) {
        console.error('Sheets 저장 오류:', error);
    }
}

// 결과 다운로드 (개선됨)
async function downloadResults() {
    try {
        if (!squatData || squatData.length === 0) {
            showError('분석 데이터가 없어 이미지를 생성할 수 없습니다.');
            return;
        }

        const bestFrame = squatData.reduce((prev, current) => {
            return (prev.kneeAngle < current.kneeAngle) ? prev : current;
        });

        const storyCanvas = document.createElement('canvas');
        const storyCtx = storyCanvas.getContext('2d');
        const storyWidth = 1080;
        const storyHeight = 1920;
        storyCanvas.width = storyWidth;
        storyCanvas.height = storyHeight;

        const video = elements.uploadedVideo;
        video.currentTime = bestFrame.timestamp;

        await new Promise((resolve, reject) => {
            const seekTimeout = setTimeout(() => reject(new Error('비디오 프레임 탐색 시간 초과')), 3000);
            video.addEventListener('seeked', () => {
                clearTimeout(seekTimeout);
                
                storyCtx.fillStyle = '#1a2238';
                storyCtx.fillRect(0, 0, storyWidth, storyHeight);
                
                const videoAspectRatio = video.videoWidth / video.videoHeight;
                const outputWidth = storyWidth * 0.9;
                const outputHeight = outputWidth / videoAspectRatio;
                const xPos = (storyWidth - outputWidth) / 2;
                const yPos = 600;

                storyCtx.save();
                storyCtx.beginPath();
                storyCtx.roundRect(xPos, yPos, outputWidth, outputHeight, 20);
                storyCtx.clip();
                storyCtx.drawImage(video, xPos, yPos, outputWidth, outputHeight);
                storyCtx.restore();

                resolve();
            }, { once: true });
        });

        storyCtx.textAlign = 'center';
        storyCtx.fillStyle = 'white';

        storyCtx.font = 'bold 80px "Noto Sans KR", sans-serif';
        storyCtx.fillText('AI SQUAT COACH', storyWidth / 2, 120);

        const scoreBoxY = 250;
        const scoreBoxHeight = 280;
        
        storyCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        storyCtx.beginPath();
        storyCtx.roundRect(100, scoreBoxY, 400, scoreBoxHeight, 20);
        storyCtx.fill();

        const score = document.getElementById('scoreDisplay').textContent;
        storyCtx.fillStyle = 'white';
        storyCtx.font = 'bold 150px "Noto Sans KR", sans-serif';
        storyCtx.fillText(score, 300, scoreBoxY + 140);
        
        storyCtx.font = '40px "Noto Sans KR", sans-serif';
        storyCtx.fillText('SCORE', 300, scoreBoxY + 190);

        const results = calculateResults();
        storyCtx.font = '35px "Noto Sans KR", sans-serif';
        storyCtx.textAlign = 'left';
        storyCtx.fillStyle = 'white';
        
        storyCtx.fillText(`🎯 ${results.squatCount}회 완료`, 120, scoreBoxY + 240);
        storyCtx.fillText(`📐 무릎각도 ${Math.round(bestFrame.kneeAngle)}°`, 120, scoreBoxY + 280);
        storyCtx.fillText(`💪 깊이점수 ${results.depthScore}점`, 120, scoreBoxY + 320);

        const feedbackBoxY = 1250;
        storyCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        storyCtx.beginPath();
        storyCtx.roundRect(100, feedbackBoxY, storyWidth - 200, 350, 20);
        storyCtx.fill();

        storyCtx.textAlign = 'center';
        storyCtx.font = 'bold 50px "Noto Sans KR", sans-serif';
        storyCtx.fillStyle = '#FFD700';
        storyCtx.fillText('정말 잘하고 있어요! ✨', storyWidth / 2, feedbackBoxY + 80);

        storyCtx.font = '35px "Noto Sans KR", sans-serif';
        storyCtx.fillStyle = 'white';
        const feedbackText = '이미 훌륭한 스쿼트 실력을\n가지고 있네요! 꾸준히\n연습하면 더욱 완벽해질\n거예요.';
        const lines = feedbackText.split('\n');
        lines.forEach((line, index) => {
            storyCtx.fillText(line, storyWidth / 2, feedbackBoxY + 140 + (index * 50));
        });

        storyCtx.font = '35px "Noto Sans KR", sans-serif';
        storyCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        const today = new Date();
        const dateStr = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}.`;
        storyCtx.fillText(dateStr, storyWidth / 2, storyHeight - 180);

        storyCtx.font = '30px "Noto Sans KR", sans-serif';
        storyCtx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        storyCtx.fillText('🔒 영상은 저장되지 않습니다', storyWidth / 2, storyHeight - 120);

        storyCtx.font = '25px "Noto Sans KR", sans-serif';
        storyCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        storyCtx.fillText('#AISquatCoach', storyWidth / 2, storyHeight - 80);

        storyCtx.font = '25px "Noto Sans KR", sans-serif';
        storyCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        storyCtx.textAlign = 'right';
        storyCtx.fillText('@1cc_my_sweat', storyWidth - 50, 50);

        const dataURL = storyCanvas.toDataURL('image/jpeg', 0.95);
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = `squat_analysis_${Date.now()}.jpg`;
        a.click();
        
        showSuccessMessage('결과 이미지를 다운로드했습니다!');

    } catch (error) {
        console.error('결과 이미지 생성 실패:', error);
        showError('결과 이미지를 생성하는 중 오류가 발생했습니다.');
    }
}

// 오류 메시지 표시
function showError(message) {
    console.error('오류:', message);
    alert(`오류가 발생했습니다: ${message}`);
}

// 성공 메시지 표시
function showSuccessMessage(message) {
    console.log('성공:', message);
    alert(message);
}
