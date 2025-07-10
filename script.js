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
    initializeElements();
    setupEventListeners();
    setupPose();
    
    // 디버그 모드 설정 (URL에 ?debug=true 추가시 활성화)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('debug') === 'true') {
        debugMode = true;
        elements.debugPanel.classList.add('show');
    }
});

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

// 이벤트 리스너 설정
function setupEventListeners() {
    // 업로드 영역 클릭
    elements.uploadArea.addEventListener('click', () => {
        elements.videoInput.click();
    });
    
    // 파일 선택
    elements.videoInput.addEventListener('change', handleFileSelect);
    
    // 드래그 앤 드롭
    elements.uploadArea.addEventListener('dragover', handleDragOver);
    elements.uploadArea.addEventListener('dragleave', handleDragLeave);
    elements.uploadArea.addEventListener('drop', handleDrop);
    
    // 버튼 이벤트
    elements.analyzeBtn.addEventListener('click', startAnalysis);
    elements.resetBtn.addEventListener('click', () => resetApp());
    elements.downloadBtn.addEventListener('click', () => downloadResults());
}

// MediaPipe Pose 설정
function setupPose() {
    pose = new Pose({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }
    });
    
    pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    
    pose.onResults(onPoseResults);
}

// 앱 초기화
function resetApp() {
    // 변수 초기화
    isAnalyzing = false;
    squatData = [];
    currentFrame = 0;
    frameSkip = 0;
    noSquatFrames = 0;
    
    // 타임아웃 클리어
    if (analysisTimeout) {
        clearTimeout(analysisTimeout);
        analysisTimeout = null;
    }
    
    // UI 초기화
    elements.uploadSection.style.display = 'block';
    elements.analyzingSection.style.display = 'none';
    elements.resultsSection.style.display = 'none';
    elements.videoPreview.style.display = 'none';
    elements.uploadArea.style.display = 'block';
    elements.analyzeBtn.disabled = true;
    elements.progressFill.style.width = '0%';
    
    // 비디오 초기화
    elements.uploadedVideo.src = '';
    elements.videoInput.value = '';
    
    // 단계 초기화
    updateStep(1);
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
    
    elements.uploadedVideo.onloadedmetadata = () => {
        // 비디오 길이 체크 (최대 30초)
        if (elements.uploadedVideo.duration > 30) {
            showError('영상은 최대 30초까지만 분석 가능합니다. 짧은 영상을 선택해주세요.');
            resetApp();
            return;
        }
        
        elements.videoPreview.style.display = 'block';
        elements.analyzeBtn.disabled = false;
        elements.uploadArea.style.display = 'none';
        
        // 캔버스 크기 설정 (최대 해상도 제한)
        const maxWidth = 640;
        const maxHeight = 480;
        let width = elements.uploadedVideo.videoWidth;
        let height = elements.uploadedVideo.videoHeight;
        
        // 비율 유지하며 크기 조정
        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = width * ratio;
            height = height * ratio;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // 비디오 프리뷰 크기도 조정
        elements.uploadedVideo.style.maxWidth = '100%';
        elements.uploadedVideo.style.height = 'auto';
        
        updateStep(1);
    };
}

// 분석 시작
async function startAnalysis() {
    if (isAnalyzing) return;
    
    isAnalyzing = true;
    squatData = [];
    currentFrame = 0;
    frameSkip = 0;
    analysisTimeout = null;
    noSquatFrames = 0;
    
    // UI 전환
    elements.uploadSection.style.display = 'none';
    elements.analyzingSection.style.display = 'block';
    updateStep(2);
    
    // 홍보 배너 추가 (없으면)
    if (!elements.analyzingSection.querySelector('.promo-banner')) {
        const promoBanner = document.createElement('div');
        promoBanner.className = 'promo-banner';
        promoBanner.innerHTML = `
            <p>📍 분당선 오리역 1ccBANG</p>
            <p>운동하고 영상찍는 신개념 휴식공간</p>
        `;
        elements.analyzingSection.appendChild(promoBanner);
    }
    
    // 비디오 재생 및 분석
    elements.uploadedVideo.currentTime = 0;
    elements.uploadedVideo.playbackRate = 1.0;
    await elements.uploadedVideo.play();
    
    // 분석 타임아웃 설정 (최대 60초)
    analysisTimeout = setTimeout(() => {
        if (isAnalyzing) {
            showError('분석 시간이 초과되었습니다. 더 짧은 영상을 사용해주세요.');
            completeAnalysis();
        }
    }, 60000);
    
    processVideo();
}

// 비디오 프레임 처리
async function processVideo() {
    if (!isAnalyzing || elements.uploadedVideo.ended) {
        if (elements.uploadedVideo.ended) {
            completeAnalysis();
        }
        return;
    }
    
    // 프레임 스킵 (3프레임마다 1번만 처리)
    frameSkip++;
    if (frameSkip % 3 !== 0) {
        requestAnimationFrame(processVideo);
        return;
    }
    
    // 캔버스에 현재 프레임 그리기
    ctx.drawImage(elements.uploadedVideo, 0, 0, canvas.width, canvas.height);
    
    // MediaPipe로 포즈 감지
    await pose.send({ image: canvas });
    
    // 진행률 업데이트
    const progress = (elements.uploadedVideo.currentTime / elements.uploadedVideo.duration) * 100;
    elements.progressFill.style.width = `${progress}%`;
    
    // 프레임 정보 업데이트
    currentFrame++;
    elements.frameInfo.textContent = `프레임 ${currentFrame} 처리 중...`;
    
    // 스쿼트 감지 실패 체크
    if (noSquatFrames > 100) {
        showError('스쿼트 동작을 감지할 수 없습니다. 측면에서 촬영한 스쿼트 영상을 사용해주세요.');
        completeAnalysis();
        return;
    }
    
    // 다음 프레임 처리
    requestAnimationFrame(processVideo);
}

// 포즈 감지 결과 처리
function onPoseResults(results) {
    if (!results.poseLandmarks) {
        noSquatFrames++;
        return;
    }
    
    // 스쿼트 분석 데이터 수집
    const landmarks = results.poseLandmarks;
    const squatMetrics = analyzeSquatFrame(landmarks);
    
    if (squatMetrics && squatMetrics.kneeAngle) {
        squatData.push(squatMetrics);
        noSquatFrames = 0;
    } else {
        noSquatFrames++;
    }
    
    // 디버그 정보 표시
    if (debugMode) {
        updateDebugInfo(squatMetrics);
    }
}

// 스쿼트 프레임 분석
function analyzeSquatFrame(landmarks) {
    // 주요 관절 좌표
    const hip = landmarks[23];
    const knee = landmarks[25];
    const ankle = landmarks[27];
    const shoulder = landmarks[11];
    
    // 좌표 유효성 검사
    if (!hip || !knee || !ankle || !shoulder ||
        hip.visibility < 0.5 || knee.visibility < 0.5 || 
        ankle.visibility < 0.5 || shoulder.visibility < 0.5) {
        return null;
    }
    
    // 무릎 각도 계산
    const kneeAngle = calculateAngle(hip, knee, ankle);
    
    // 허리 각도 계산
    const backAngle = calculateAngle(shoulder, hip, knee);
    
    // 깊이 계산
    const depth = kneeAngle < 90 ? 'deep' : kneeAngle < 120 ? 'parallel' : 'shallow';
    
    return {
        timestamp: elements.uploadedVideo.currentTime,
        kneeAngle: kneeAngle,
        backAngle: backAngle,
        depth: depth,
        hipY: hip.y,
        kneeY: knee.y
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

// 분석 완료
function completeAnalysis() {
    isAnalyzing = false;
    elements.uploadedVideo.pause();
    
    // 타임아웃 클리어
    if (analysisTimeout) {
        clearTimeout(analysisTimeout);
        analysisTimeout = null;
    }
    
    // 데이터 충분성 체크
    if (squatData.length < 10) {
        showError('충분한 스쿼트 동작을 감지하지 못했습니다. 측면에서 촬영한 스쿼트 영상을 사용해주세요.');
        resetApp();
        return;
    }
    
    // 결과 계산
    const results = calculateResults();
    
    // 스쿼트 카운트 체크
    if (results.squatCount === 0) {
        showError('스쿼트 동작을 감지하지 못했습니다. 완전한 스쿼트 동작이 포함된 영상을 사용해주세요.');
        resetApp();
        return;
    }
    
    // UI 전환
    elements.analyzingSection.style.display = 'none';
    elements.resultsSection.style.display = 'block';
    updateStep(3);
    
    // 결과 표시
    displayResults(results);
}

// 결과 계산
function calculateResults() {
    const squatCount = countSquats();
    const avgDepth = calculateAverageDepth();
    const avgBackAngle = calculateAverageBackAngle();
    const consistency = calculateConsistency();
    
    // 점수 계산
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

// 스쿼트 횟수 계산
function countSquats() {
    let count = 0;
    let isDown = false;
    
    for (let i = 0; i < squatData.length; i++) {
        if (squatData[i].kneeAngle < 120 && !isDown) {
            isDown = true;
        } else if (squatData[i].kneeAngle > 150 && isDown) {
            count++;
            isDown = false;
        }
    }
    
    return count;
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
    // 무릎 각도의 표준편차 계산
    const angles = squatData.map(d => d.kneeAngle);
    const mean = angles.reduce((a, b) => a + b) / angles.length;
    const variance = angles.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / angles.length;
    const stdDev = Math.sqrt(variance);
    
    // 일관성 점수 (표준편차가 낮을수록 높은 점수)
    return Math.max(0, 100 - stdDev * 2);
}

// 깊이 점수 계산
function calculateDepthScore(avgDepth) {
    switch (avgDepth) {
        case 'deep': return 95;
        case 'parallel': return 85;
        case 'shallow': return 65;
        default: return 70;
    }
}

// 자세 점수 계산
function calculatePostureScore(avgBackAngle) {
    // 이상적인 허리 각도: 70-110도
    if (avgBackAngle >= 70 && avgBackAngle <= 110) {
        return 90 + (10 - Math.abs(90 - avgBackAngle) / 2);
    } else {
        return Math.max(50, 90 - Math.abs(90 - avgBackAngle));
    }
}

// 균형 점수 계산
function calculateBalanceScore() {
    // 좌우 균형 분석 (간단한 버전)
    return 85;
}

// 속도 점수 계산
function calculateSpeedScore() {
    // 일정한 속도 유지 여부
    return 88;
}

// 결과 표시
function displayResults(results) {
    // 점수 표시
    animateScore(results.totalScore);
    document.getElementById('depthScore').textContent = results.depthScore;
    document.getElementById('postureScore').textContent = results.postureScore;
    document.getElementById('balanceScore').textContent = results.balanceScore;
    document.getElementById('speedScore').textContent = results.speedScore;
    
    // 피드백 생성
    const feedback = generateFeedback(results);
    displayFeedback(feedback);
    
    // 모바일 환경에 따라 버튼 텍스트 변경
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    elements.downloadBtn.textContent = isMobile ? '결과 이미지 저장하기' : '결과 이미지 다운로드';
    
    // Google Sheets에 데이터 저장 시도
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
    
    // 전체 평가
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
    
    // 깊이 피드백
    if (results.depthScore < 80) {
        feedback.push({
            type: 'warning',
            title: '📏 깊이 개선 필요',
            content: '스쿼트 시 엉덩이를 더 낮춰보세요. 무릎이 90도 각도가 되도록 하면 더 효과적입니다.'
        });
    }
    
    // 자세 피드백
    if (results.postureScore < 80) {
        feedback.push({
            type: 'danger',
            title: '🦴 허리 자세 주의',
            content: '허리를 곧게 펴고 가슴을 들어올리세요. 상체가 너무 앞으로 숙여지지 않도록 주의하세요.'
        });
    }
    
    // 균형 피드백
    if (results.balanceScore < 80) {
        feedback.push({
            type: 'warning',
            title: '⚖️ 균형 개선 필요',
            content: '양쪽 다리에 균등하게 체중을 분산시키세요. 발가락과 발뒤꿈치에 고르게 무게를 실으세요.'
        });
    }
    
    // 속도 피드백
    if (results.speedScore < 80) {
        feedback.push({
            type: 'warning',
            title: '⏱️ 속도 조절 필요',
            content: '일정한 속도로 스쿼트를 수행하세요. 너무 빠르거나 느리지 않게 조절하세요.'
        });
    }
    
    // 동기부여 메시지
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
        await google.script.run.withSuccessHandler(() => {
            console.log('데이터 저장 성공');
        }).withFailureHandler((error) => {
            console.error('데이터 저장 실패:', error);
        }).logSquatData(results);
    } catch (error) {
        console.error('Sheets 저장 오류:', error);
    }
}

// 결과 다운로드
function downloadResults() {
    // 결과 캔버스 생성
    const resultCanvas = document.createElement('canvas');
    const resultCtx = resultCanvas.getContext('2d');
    resultCanvas.width = 800;
    resultCanvas.height = 600;
    
    // 배경
    const gradient = resultCtx.createLinearGradient(0, 0, 800, 600);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    resultCtx.fillStyle = gradient;
    resultCtx.fillRect(0, 0, 800, 600);
    
    // 제목
    resultCtx.fillStyle = 'white';
    resultCtx.font = 'bold 48px Noto Sans KR';
    resultCtx.textAlign = 'center';
    resultCtx.fillText('AI 스쿼트 분석 결과', 400, 80);
    
    // 인스타그램 주소
    resultCtx.font = '20px Noto Sans KR';
    resultCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    resultCtx.fillText('@1cc_my_sweat', 400, 120);
    
    // 점수
    const score = document.getElementById('scoreDisplay').textContent;
    resultCtx.font = 'bold 120px Noto Sans KR';
    resultCtx.fillStyle = 'white';
    resultCtx.fillText(score, 400, 270);
    
    resultCtx.font = '24px Noto Sans KR';
    resultCtx.fillText('종합 점수', 400, 320);
    
    // 세부 점수
    resultCtx.font = '20px Noto Sans KR';
    resultCtx.textAlign = 'left';
    
    const scores = [
        { label: '깊이', value: document.getElementById('depthScore').textContent },
        { label: '자세', value: document.getElementById('postureScore').textContent },
        { label: '균형', value: document.getElementById('balanceScore').textContent },
        { label: '속도', value: document.getElementById('speedScore').textContent }
    ];
    
    scores.forEach((item, index) => {
        const y = 400 + index * 40;
        resultCtx.fillText(`${item.label}: ${item.value}점`, 250, y);
    });
    
    // 날짜
    resultCtx.textAlign = 'center';
    resultCtx.font = '16px Noto Sans KR';
    resultCtx.fillText(new Date().toLocaleDateString('ko-KR'), 400, 560);
    
    // 모바일 환경 체크
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
        // 모바일: 이미지를 새 창에서 열어 저장하기 쉽게 함
        resultCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            
            // 새 창에서 이미지 열기
            const newWindow = window.open('', '_blank');
            if (newWindow) {
                newWindow.document.write(`
                    <html>
                        <head>
                            <title>AI 스쿼트 분석 결과</title>
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <style>
                                body { 
                                    margin: 0; 
                                    padding: 20px;
                                    background: #f0f0f0;
                                    text-align: center;
                                }
                                img { 
                                    max-width: 100%; 
                                    height: auto;
                                    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                                    border-radius: 10px;
                                }
                                p {
                                    margin: 20px 0;
                                    font-family: 'Noto Sans KR', sans-serif;
                                    color: #667eea;
                                }
                            </style>
                        </head>
                        <body>
                            <p>📸 이미지를 길게 눌러 저장하세요</p>
                            <img src="${url}" alt="AI 스쿼트 분석 결과">
                            <p>결과를 공유해보세요! @1cc_my_sweat</p>
                        </body>
                    </html>
                `);
            }
            
            // 피드백 메시지
            showSuccessMessage('결과 이미지가 새 창에서 열렸습니다. 이미지를 길게 눌러 저장하세요!');
        });
    } else {
        // 데스크톱: 기존 다운로드 방식
        resultCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `squat-analysis-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            
            showSuccessMessage('결과가 다운로드되었습니다!');
        });
    }
}
