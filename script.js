import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.12";

// DOM 요소 참조 (전역 스코프 유지)
const getElement = (id) => {
    const element = document.getElementById(id);
    if (!element) console.warn(`Element with id '${id}' not found`);
    return element;
};

const videoUpload = getElement("videoUpload");
const video = getElement("analysisVideo");
const canvasElement = getElement("output_canvas");
const canvasCtx = canvasElement?.getContext("2d");
const videoContainer = getElement("videoContainer");
const statusElement = getElement("status");
const feedbackList = getElement("feedbackList");
const shareStoryBtn = getElement("shareStoryBtn");
const uploadSection = getElement('upload-section');
const analysisSection = getElement('analysis-section');
const resultSection = getElement('result-section');
const storyCanvas = getElement('story-canvas');
const storyCtx = storyCanvas?.getContext('2d');
const coachFeedbackArea = getElement('coach-feedback-area');
const storyCanvasContainer = getElement('story-canvas-container');
const startAnalysisBtn = getElement('startAnalysisBtn');
const resetBtn = getElement('resetBtn');
const noSquatResultArea = getElement('no-squat-result-area');
const initialStatus = getElement('initial-status');

// 스쿼트 분석 관련 변수 (전역 스코프 유지)
let poseLandmarker, squatCount = 0, bestMomentTime = 0, lowestKneeAngle = 180, animationFrameId, analysisStarted = false;
let squatAnalyzer;

// 디버그 모드 토글 (개발 시 true, 배포 시 false)
const DEBUG_MODE = true;

// ======== 유틸리티 함수들 (클래스 및 이벤트 리스너보다 먼저 정의되어야 함) ========

function calculateAngle(point1, point2, point3) {
    const vector1 = {
        x: point1.x - point2.x,
        y: point1.y - point2.y
    };
    const vector2 = {
        x: point3.x - point2.x,
        y: point3.y - point2.y
    };
    
    const dot = vector1.x * vector2.x + vector1.y * vector2.y;
    const mag1 = Math.sqrt(vector1.x * vector1.x + vector1.y * vector1.y);
    const mag2 = Math.sqrt(vector2.x * vector2.x + vector2.y * vector2.y);
    
    if (mag1 === 0 || mag2 === 0) return 0;
    
    const cosAngle = dot / (mag1 * mag2);
    const clampedCos = Math.max(-1, Math.min(1, cosAngle));
    return Math.acos(clampedCos) * (180 / Math.PI);
}

function updateStatus(message, isLoading = false) {
    if (statusElement) statusElement.innerHTML = isLoading ? `<span class="loading"></span> ${message}` : message;
}

function showRegularResults() {
    if(storyCanvasContainer) storyCanvasContainer.style.display = 'block';
    if(noSquatResultArea) noSquatResultArea.style.display = 'none';
    if(coachFeedbackArea) coachFeedbackArea.style.display = 'block';
    if(shareStoryBtn) shareStoryBtn.style.display = 'block';
}

function showNoSquatResults() {
    if(noSquatResultArea) {
        noSquatResultArea.innerHTML = `<h2>분석 실패! 🤖</h2><p style="margin-top: 20px;">유효한 스쿼트 동작을 인식하지 못했습니다.</p><p>자세나 영상 각도를 확인 후 다시 시도해보세요.</p>
        <p class="privacy-note">**개인 정보 보호:** 업로드하신 영상은 사용자 기기에서만 분석되며, **어떠한 영상도 서버에 저장되지 않습니다.**</p>`;
        noSquatResultArea.style.display = 'block';
    }
    if(storyCanvasContainer) storyCanvasContainer.style.display = 'none';
    if(coachFeedbackArea) coachFeedbackArea.style.display = 'none';
    if(shareStoryBtn) shareStoryBtn.style.display = 'none';
}

// 피드백 내용을 더 구체적으로 강화
function getDetailedFeedback(scores) {
    const feedbackMessages = [];
    let overallFeedbackClass = 'feedback-good'; // 기본은 좋음

    if (scores.depth < 60) {
        feedbackMessages.push('<span class="feedback-warning">⚠️</span> **깊이가 아쉬워요!** 허벅지가 지면과 평행하게 내려가도록 노력해 보세요.');
        overallFeedbackClass = 'feedback-warning';
    } else if (scores.depth < 80) {
        feedbackMessages.push('<span class="feedback-info">💡</span> 스쿼트 깊이는 좋아요! 조금 더 깊이 앉으면 더 큰 효과를 볼 수 있어요.');
    } else {
        feedbackMessages.push('<span class="feedback-good">👍</span> **완벽한 깊이!** 아주 안정적으로 내려가셨어요.');
    }

    if (scores.backPosture < 60) {
        feedbackMessages.push('<span class="feedback-warning">⚠️</span> **상체가 너무 숙여지거나 굽혀졌어요.** 가슴을 펴고 시선을 정면으로 유지해 보세요!');
        overallFeedbackClass = 'feedback-warning';
    } else if (scores.backPosture < 80) {
        feedbackMessages.push('<span class="feedback-info">💡</span> 상체 자세는 괜찮아요. 코어에 좀 더 힘을 주면 더욱 안정적일 거예요.');
    } else {
        feedbackMessages.push('<span class="feedback-good">👍</span> **훌륭한 등 자세!** 부상 위험 없이 바른 자세를 유지하셨어요.');
    }

    if (scores.kneeAlignment < 60) {
        feedbackMessages.push('<span class="feedback-warning">⚠️</span> **무릎이 안으로 모이거나 발끝을 너무 넘어갔어요.** 무릎이 발끝 방향과 일직선이 되도록 신경 써 주세요!');
        overallFeedbackClass = 'feedback-warning';
    } else if (scores.kneeAlignment < 80) {
        feedbackMessages.push('<span class="feedback-info">💡</span> 무릎 정렬은 나쁘지 않아요. 스쿼트 시 무릎과 발의 정렬을 항상 의식해 보세요.');
    } else {
        feedbackMessages.push('<span class="feedback-good">👍</span> **안정적인 무릎 정렬!** 무릎 부담을 줄이는 바른 자세예요.');
    }

    if (scores.control < 60) {
        feedbackMessages.push('<span class="feedback-warning">⚠️</span> **움직임이 너무 빠르거나 불안정했어요.** 천천히, 통제된 움직임으로 스쿼트 해보세요.');
        overallFeedbackClass = 'feedback-warning';
    } else if (scores.control < 80) {
        feedbackMessages.push('<span class="feedback-info">💡</span> 움직임 제어는 괜찮아요. 더욱 천천히, 근육의 움직임을 느끼며 수행해 보세요.');
    } else {
        feedbackMessages.push('<span class="feedback-good">👍</span> **완벽한 컨트롤!** 아주 부드럽고 안정적인 스쿼트였어요.');
    }

    if (feedbackMessages.length === 0) {
        feedbackMessages.push('<span class="feedback-good">✨</span> **AI 코치도 놀란 완벽한 스쿼트!** 이대로 꾸준히 노력하면 됩니다!');
    }

    // 전반적인 피드백 메시지를 가장 위에 추가
    let overallMessage;
    if (scores.total >= 90) overallMessage = "완벽에 가까운 스쿼트! 자세 교본으로 써도 되겠어요. 👏";
    else if (scores.total >= 80) overallMessage = "훌륭해요! 안정적인 자세가 돋보입니다. 😉";
    else if (scores.total >= 70) overallMessage = "좋아요! 기본기가 탄탄하시네요. 조금만 더 신경 쓰면 완벽할 거예요.";
    else if (scores.total >= 50) overallMessage = "잘하고 있어요! 꾸준히 하면 좋아질 거예요. 화이팅!";
    else overallMessage = "아직 개선할 점이 많지만, 시작이 반! 우리와 함께 만들어가요! 💪";
    
    feedbackMessages.unshift(`<p style="font-weight: bold; font-size: 1.2em;">${overallMessage}</p><hr style="border: 0; height: 1px; background: #eee; margin: 10px 0;">`);

    return {
        html: `<div class="${overallFeedbackClass}">${feedbackMessages.join('<br>')}</div>`,
        overallScore: scores.total
    };
}


async function createShareableImage(finalScore, detailedFeedbackHtml) {
    if (!video || !video.duration || !video.videoWidth || !video.videoHeight) return;
    if (!storyCanvas || !storyCtx) return;
    
    storyCanvas.style.display = 'block';
    const tempVideoCanvas = document.createElement('canvas');
    const tempVideoCtx = tempVideoCanvas.getContext('2d');

    video.currentTime = bestMomentTime;
    
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            video.removeEventListener('seeked', onSeeked);
            reject(new Error('Video seek timeout'));
        }, 5000);
        
        const onSeeked = () => {
            clearTimeout(timeout);
            video.removeEventListener('seeked', onSeeked);
            resolve();
        };
        
        video.addEventListener('seeked', onSeeked);
    });
    
    tempVideoCanvas.width = video.videoWidth;
    tempVideoCanvas.height = video.videoHeight;
    tempVideoCtx.drawImage(video, 0, 0, tempVideoCanvas.width, tempVideoCanvas.height);

    const storyWidth = 1080, storyHeight = 1920; // 9:16 비율
    storyCanvas.width = storyWidth;
    storyCanvas.height = storyHeight;

    // 배경 그라데이션
    storyCtx.fillStyle = '#1a1a1a';
    storyCtx.fillRect(0, 0, storyWidth, storyHeight);

    const gradient = storyCtx.createLinearGradient(0, 0, 0, storyHeight);
    gradient.addColorStop(0, 'rgba(0,0,0,0.7)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.3)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
    storyCtx.fillStyle = gradient;
    storyCtx.fillRect(0, 0, storyWidth, storyHeight);

    // 비디오 이미지 그리기 (중앙에 배치, 비율 유지)
    const videoAspectRatio = tempVideoCanvas.width / tempVideoCanvas.height;
    const outputWidth = storyWidth * 0.9; // 화면 너비의 90% 사용
    const outputHeight = outputWidth / videoAspectRatio;
    const xPosVideo = (storyWidth - outputWidth) / 2;
    const yPosVideo = (storyHeight * 0.5 - outputHeight) / 2; // 상단 50% 영역에 배치

    storyCtx.drawImage(tempVideoCanvas, xPosVideo, yPosVideo, outputWidth, outputHeight);

    // 텍스트 스타일링 및 그리기
    storyCtx.shadowColor = 'rgba(0,0,0,0.5)';
    storyCtx.shadowBlur = 10;
    storyCtx.textAlign = 'center';
    storyCtx.fillStyle = 'white';

    // 타이틀
    storyCtx.font = 'bold 120px "Noto Sans KR", sans-serif';
    storyCtx.fillText('✨ 최고의 순간 ✨', storyWidth / 2, yPosVideo - 50);

    // 점수
    storyCtx.font = 'bold 300px "Noto Sans KR", sans-serif'; // 점수 더 크게
    storyCtx.fillStyle = '#FFC107'; // 강조 색상
    storyCtx.fillText(finalScore, storyWidth / 2, storyHeight - 350);

    storyCtx.font = '80px "Noto Sans KR", sans-serif'; // /100 더 크게
    storyCtx.fillStyle = 'white';
    storyCtx.fillText('/100', storyWidth / 2 + 250, storyHeight - 350); // 위치 조정

    storyCtx.shadowBlur = 0; // 그림자 제거

    // 피드백 (HTML을 캔버스에 직접 그릴 수 없으므로, 텍스트만 추출하여 그리기)
    // 여기서는 간단히 HTML 태그를 제거하고 텍스트만 추출하여 사용
    const feedbackText = detailedFeedbackHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' '); // HTML 태그 제거 및 &nbsp; 처리
    storyCtx.font = '60px "Noto Sans KR", sans-serif';
    storyCtx.fillStyle = 'white';
    wrapText(storyCtx, feedbackText, storyWidth / 2, storyHeight - 200, storyWidth - 100, 70);
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    for(let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        let metrics = context.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
            context.fillText(line, x, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else {
            line = testLine;
        }
    }
    context.fillText(line, x, y);
}


// 개선된 스쿼트 분석 함수를 포함하는 클래스
class SquatAnalyzer {
    constructor() {
        // 모든 메서드에 'this' 바인딩
        this.smoothAngle = this.smoothAngle.bind(this);
        this.calculateMovementVelocity = this.calculateMovementVelocity.bind(this);
        this.validateSquatQuality = this.validateSquatQuality.bind(this);
        this.detectNonSquatMovement = this.detectNonSquatMovement.bind(this);
        this.analyzeBetterSquat = this.analyzeBetterSquat.bind(this);
        this.reset = this.reset.bind(this);

        this.angleHistory = [];
        this.velocityHistory = [];
        this.SMOOTHING_WINDOW = 5; // 스무딩 윈도우 크기 증가 (더 부드러운 값)
        this.squatPhase = 'standing';
        this.frameCount = 0;
        this.totalScores = { depth: 0, backPosture: 0, kneeAlignment: 0, control: 0 }; // 무릎 정렬 및 제어 점수 추가
        this.repReachedMinDepth = false;
        this.bottomHoldFrames = 0;
        this.bestKneeAngleInRep = 180; // 현재 스쿼트 반복에서 가장 낮은 무릎 각도

        this.squatQualityChecks = {
            hasProperDepth: false,
            hasControlledMovement: false,
            hasSymmetricMovement: false, // 좌우 대칭은 유지 (무릎 높이)
            hasGoodKneeAlignment: false // 무릎 정렬 추가
        };

        // 임계값 (당신 제안 반영 및 조정)
        this.STANDING_KNEE_THRESHOLD = 160;     // 서있는 상태
        this.DESCENDING_KNEE_THRESHOLD = 150;   // 하강 시작
        this.BOTTOM_KNEE_THRESHOLD = 90;       // 스쿼트 바닥 (더 엄격하게 90도로 조정)
        this.ASCENDING_KNEE_THRESHOLD = 100;    // 상승 시작 (BOTTOM보다 살짝 높게)

        this.MIN_SQUAT_DURATION_FRAMES = 10; // 유효한 스쿼트 동작의 최소 프레임 수 증가
        this.MIN_BOTTOM_HOLD_FRAMES = 3;    // 최하점 상태를 유지해야 하는 최소 프레임 수 증가 (안정성)
        
        this.isSquatDetectedInVideo = false; // 영상 전체에서 한 번이라도 스쿼트가 감지되었는지
    }

    // 각도 스무딩
    smoothAngle(newAngle) {
        this.angleHistory.push(newAngle);
        if (this.angleHistory.length > this.SMOOTHING_WINDOW) {
            this.angleHistory.shift();
        }
        return this.angleHistory.reduce((sum, angle) => sum + angle, 0) / this.angleHistory.length;
    }

    // 움직임 속도 계산 (갑작스러운 변화 감지)
    calculateMovementVelocity(currentAngle) {
        if (this.angleHistory.length < 2) return 0;
        
        const prevAngle = this.angleHistory[this.angleHistory.length - 2];
        const velocity = Math.abs(currentAngle - prevAngle);
        
        this.velocityHistory.push(velocity);
        if (this.velocityHistory.length > 10) { // 속도 히스토리 10프레임 유지
            this.velocityHistory.shift();
        }
        
        // 평균 속도를 반환하여 제어 점수에 활용
        return this.velocityHistory.reduce((sum, v) => sum + v, 0) / this.velocityHistory.length;
    }

    // 스쿼트 품질 검증
    validateSquatQuality(kneeAngle, leftKnee, rightKnee, leftAnkle, rightAnkle, hip, velocity) {
        // 1. 적절한 깊이 확인
        this.squatQualityChecks.hasProperDepth = kneeAngle <= this.BOTTOM_KNEE_THRESHOLD;
        
        // 2. 제어된 움직임 (너무 빠르지 않은) - 평균 속도 활용
        // 속도가 낮을수록 점수가 높아야 하므로, 반비례 관계를 고려
        this.squatQualityChecks.hasControlledMovement = velocity < 10; // 임계값 조정 가능
        
        // 3. 대칭적 움직임 (좌우 무릎 높이 차이) - 정규화된 좌표 기준
        const kneeDifference = Math.abs(leftKnee.y - rightKnee.y);
        this.squatQualityChecks.hasSymmetricMovement = kneeDifference < 0.05; 

        // 4. 무릎 정렬 (무릎이 발끝을 너무 넘어가지 않도록, 또는 안으로 모이지 않도록)
        // 무릎(25, 26)과 발목(27, 28) 랜드마크를 활용
        // 측면에서 찍었을 때 무릎이 발목보다 앞으로 나오는지 (x축 기준)
        // 정면에서 찍었을 때 무릎이 발보다 안쪽으로 모이는지 (x축 기준)
        // 여기서는 간단히 무릎이 발목 X좌표보다 지나치게 벗어나지 않는지 확인
        const leftKneeX = leftKnee.x;
        const rightKneeX = rightKnee.x;
        const leftAnkleX = leftAnkle.x;
        const rightAnkleX = rightAnkle.x;

        // 예시: 무릎이 발목보다 너무 앞으로 나가지 않도록 (측면 스쿼트 가정)
        // 또는 무릎이 발 안쪽으로 모이지 않도록 (정면 스쿼트 가정)
        // 여기서는 무릎이 발목 X좌표보다 0.05 이상 넘어가지 않도록 설정
        // 실제 사용 환경에 따라 이 임계값은 조정이 필요합니다.
        const leftKneeOverAnkle = (leftKneeX < leftAnkleX - 0.05); // 왼쪽 무릎이 발목보다 너무 뒤에 있는지(x좌표 기준)
        const rightKneeOverAnkle = (rightKneeX < rightAnkleX - 0.05); // 오른쪽 무릎이 발목보다 너무 뒤에 있는지

        // 또는 무릎이 발목 X좌표보다 너무 앞서지 않는지 (측면 촬영 시)
        const leftKneeForward = (leftKneeX > leftAnkleX + 0.05);
        const rightKneeForward = (rightKneeX > rightAnkleX + 0.05);

        // 무릎이 안쪽으로 모이는 현상 (정면 촬영 시)
        // 엉덩이 너비 대비 무릎 사이 간격으로 판단
        const hipCenter = (pose[23].x + pose[24].x) / 2;
        const leftKneeToCenter = Math.abs(leftKnee.x - hipCenter);
        const rightKneeToCenter = Math.abs(rightKnee.x - hipCenter);
        const hipDistance = Math.abs(pose[23].x - pose[24].x);

        // 무릎이 엉덩이 너비에 비해 너무 좁지 않은지 확인 (임의의 임계값)
        this.squatQualityChecks.hasGoodKneeAlignment = !(leftKneeForward || rightKneeForward) && (leftKneeToCenter + rightKneeToCenter > hipDistance * 0.8);
        // 이 무릎 정렬 로직은 촬영 각도에 따라 매우 달라지므로, 테스트 후 조정이 필요합니다.
        
        // 4개 중 3개 이상 만족해야 유효한 스쿼트 (더 엄격하게)
        const qualityScoreCount = Object.values(this.squatQualityChecks).filter(Boolean).length;
        return qualityScoreCount >= 3;
    }

    // 비스쿼트 동작 필터링
    detectNonSquatMovement(landmarks) {
        const pose = landmarks[0];
        
        // 1. 손 위치 확인 (춤추는 동작 감지)
        const leftWrist = pose[15];
        const rightWrist = pose[16];
        const leftShoulder = pose[11];
        const rightShoulder = pose[12];
        
        if (leftWrist && rightWrist && leftShoulder && rightShoulder) {
            const handsAboveShoulders = 
                (leftWrist.y < leftShoulder.y - 0.1) || 
                (rightWrist.y < rightShoulder.y - 0.1);
            
            if (handsAboveShoulders) {
                if (DEBUG_MODE) console.log("MOVEMENT_FILTER: 춤추는 동작 감지 - 스쿼트 분석 제외 (손 위치)");
                return true; 
            }
        }
        
        // 2. 상체 각도 확인 (너무 앞으로 기울어진 경우)
        const hip = {
            x: (pose[23].x + pose[24].x) / 2,
            y: (pose[23].y + pose[24].y) / 2
        };
        const shoulder = {
            x: (pose[11].x + pose[12].x) / 2,
            y: (pose[11].y + pose[12].y) / 2
        };
        
        const vertical = { x: hip.x, y: hip.y - 1 };
        const torsoAngle = calculateAngle(shoulder, hip, vertical);
        
        if (torsoAngle > 75) { // 임계값 소폭 상향 조정 (너무 엄격하지 않게)
            if (DEBUG_MODE) console.log("MOVEMENT_FILTER: 과도한 상체 기울임 감지 - 요가/스트레칭 동작으로 판단");
            return true;
        }
        
        return false; 
    }

    // 메인 분석 함수
    analyzeBetterSquat(landmarks) {
        // 어깨(11,12), 엉덩이(23,24), 무릎(25,26), 발목(27,28)
        const requiredLandmarks = [11, 12, 23, 24, 25, 26, 27, 28];
        
        if (!landmarks || landmarks.length === 0 || !landmarks[0]) {
            if (DEBUG_MODE) console.warn("LANDMARK_STATUS: 랜드마크 데이터 없음. 스쿼트 분석 건너뜀.");
            return;
        }
        
        const pose = landmarks[0];
        
        // 필수 랜드마크 존재 및 가시성 확인
        for (let i = 0; i < requiredLandmarks.length; i++) {
            if (!pose[requiredLandmarks[i]] || pose[requiredLandmarks[i]].visibility < 0.6) { // 가시성 임계값 증가
                if (DEBUG_MODE) console.warn(`LANDMARK_STATUS: 필수 랜드마크 ${requiredLandmarks[i]}번이 감지되지 않거나 가시성(${pose[requiredLandmarks[i]]?.visibility?.toFixed(2)})이 낮음. 스쿼트 분석 건너뛰기`);
                return;
            }
        }
        
        // 비스쿼트 동작 필터링
        if (this.detectNonSquatMovement(landmarks)) {
            return; 
        }
        
        const leftHip = pose[23];
        const rightHip = pose[24];
        const leftKnee = pose[25];
        const rightKnee = pose[26];
        const leftAnkle = pose[27];
        const rightAnkle = pose[28];
        const leftShoulder = pose[11];
        const rightShoulder = pose[12];
        
        const hip = {x:(leftHip.x + rightHip.x)/2, y:(leftHip.y + rightHip.y)/2};
        const knee = {x:(leftKnee.x + rightKnee.x)/2, y:(leftKnee.y + rightKnee.y)/2};
        const ankle = {x:(leftAnkle.x + rightAnkle.x)/2, y:(leftAnkle.y + rightAnkle.y)/2};
        const shoulder = {x:(leftShoulder.x+rightShoulder.x)/2, y:(leftShoulder.y+rightShoulder.y)/2}; 

        // 각도 계산 및 스무딩
        const rawKneeAngle = calculateAngle(hip, knee, ankle); 
        const kneeAngle = this.smoothAngle(rawKneeAngle);
        
        // 움직임 속도 계산
        const velocity = this.calculateMovementVelocity(kneeAngle);
        
        // 스쿼트 품질 검증 (무릎 정렬을 포함한 새로운 validateSquatQuality 호출)
        const isValidSquat = this.validateSquatQuality(kneeAngle, leftKnee, rightKnee, leftAnkle, rightAnkle, hip, velocity);
        
        // 점수 계산 (각 품질 요소별 점수)
        let depthScore = 0;
        if (kneeAngle >= 160) depthScore = 0; 
        else if (kneeAngle <= 60) depthScore = 100; // 60도 이하를 만점으로 변경
        else { 
            depthScore = Math.round(100 - ((kneeAngle - 60) / (160 - 60)) * 100); 
        }
        depthScore = Math.round(Math.max(0, Math.min(100, depthScore))); // 0-100 범위 보장
        
        let backScore = 0;
        const idealTorsoMin = 10; // 등 자세 이상적 각도 범위
        const idealTorsoMax = 50;
        const torsoAngle = calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 1 }); 
        
        if (torsoAngle >= idealTorsoMin && torsoAngle <= idealTorsoMax) {
            backScore = 100;
        } else if (torsoAngle < idealTorsoMin) { // 너무 세워졌을 때
            backScore = Math.round(Math.max(0, 100 - (idealTorsoMin - torsoAngle) * 5));
        } else { // 너무 숙여졌을 때
            backScore = Math.round(Math.max(0, 100 - (torsoAngle - idealTorsoMax) * 3));
        }
        backScore = Math.round(Math.max(0, Math.min(100, backScore)));

        // 새로운 무릎 정렬 점수 계산 (예시 로직 - 측면/정면 조합)
        let kneeAlignmentScore = 100;
        const KNEE_ANKLE_X_DIFF_THRESHOLD = 0.08; // 무릎-발목 X좌표 차이 임계값
        const KNEE_HIP_RATIO_THRESHOLD = 0.8; // 무릎 사이 간격이 엉덩이 너비 대비 임계값

        const leftKneeOverAnkle = (leftAnkle.x - leftKnee.x > KNEE_ANKLE_X_DIFF_THRESHOLD); // 무릎이 발목보다 너무 앞으로 나오는지 (오른쪽으로 갈수록 X좌표 증가)
        const rightKneeOverAnkle = (rightAnkle.x - rightKnee.x > KNEE_ANKLE_X_DIFF_THRESHOLD);
        
        // 무릎이 발보다 뒤로 빠지는 경우도 고려 (가령, 몸이 너무 서 있을 때)
        const leftKneeBehindAnkle = (leftKnee.x - leftAnkle.x > KNEE_ANKLE_X_DIFF_THRESHOLD);
        const rightKneeBehindAnkle = (rightKnee.x - rightAnkle.x > KNEE_ANKLE_X_DIFF_THRESHOLD);

        // 무릎이 안쪽으로 모이는지 (정면 촬영 시 가정)
        const hipMidX = (pose[23].x + pose[24].x) / 2;
        const kneeDistance = Math.abs(leftKnee.x - rightKnee.x);
        const hipDistance = Math.abs(pose[23].x - pose[24].x);

        if (leftKneeOverAnkle || rightKneeOverAnkle || leftKneeBehindAnkle || rightKneeBehindAnkle) {
            kneeAlignmentScore -= 30; // 무릎이 발목을 너무 넘어가거나 뒤로 빠지면 감점
        }
        if (kneeDistance < hipDistance * KNEE_HIP_RATIO_THRESHOLD) {
            kneeAlignmentScore -= 20; // 무릎이 너무 모이면 감점
        }
        kneeAlignmentScore = Math.round(Math.max(0, Math.min(100, kneeAlignmentScore)));


        // 움직임 제어 점수 (Velocity 기반)
        let controlScore = 100;
        const AVG_VELOCITY_THRESHOLD_GOOD = 8; // 좋은 움직임 속도 (낮을수록 좋음)
        const AVG_VELOCITY_THRESHOLD_BAD = 20; // 불안정한 움직임 속도

        if (velocity > AVG_VELOCITY_THRESHOLD_BAD) {
            controlScore = Math.round(Math.max(0, 100 - (velocity - AVG_VELOCITY_THRESHOLD_BAD) * 5));
        } else if (velocity > AVG_VELOCITY_THRESHOLD_GOOD) {
            controlScore = Math.round(100 - (velocity - AVG_VELOCITY_THRESHOLD_GOOD) * 2);
        }
        controlScore = Math.round(Math.max(0, Math.min(100, controlScore)));

        // 품질 검증을 통과해야만 점수 누적 및 상태 변화 로직 진행
        if (!isValidSquat) {
            if (DEBUG_MODE) console.log("QUALITY_CHECK: 스쿼트 품질 기준 미달 - 점수 누적 및 카운트 제외");
            // 스쿼트가 아닌 동작으로 간주, 상태 초기화하거나 특정 메시지 표시 가능
            // this.squatPhase = 'standing'; // 즉시 standing으로 복귀하여 잘못된 카운트 방지
            // this.frameCount = 0;
            // this.totalScores = { depth: 0, backPosture: 0, kneeAlignment: 0, control: 0 };
            return; 
        }
        
        // 스쿼트 상태 머신 로직
        switch (this.squatPhase) {
            case 'standing':
                if (kneeAngle <= this.DESCENDING_KNEE_THRESHOLD) { 
                    this.squatPhase = 'descending';
                    this.frameCount = 0;
                    this.bottomHoldFrames = 0;
                    this.repReachedMinDepth = false; 
                    this.bestKneeAngleInRep = 180; // 새 반복 시작 시 최고 각도 초기화
                    this.totalScores = { depth: 0, backPosture: 0, kneeAlignment: 0, control: 0 }; 
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: **DESCENDING** (무릎 각도: ${kneeAngle.toFixed(2)})`);
                } else {
                    if (DEBUG_MODE) console.log(`DEBUG_STANDING: Standing. Knee: ${kneeAngle.toFixed(2)}, DescendingThresh: ${this.DESCENDING_KNEE_THRESHOLD}`);
                }
                break;

            case 'descending':
                this.bestKneeAngleInRep = Math.min(this.bestKneeAngleInRep, kneeAngle); // 하강 중 가장 낮은 각도 기록
                if (kneeAngle <= this.BOTTOM_KNEE_THRESHOLD) {
                    this.bottomHoldFrames++;
                    if (this.bottomHoldFrames >= this.MIN_BOTTOM_HOLD_FRAMES) { 
                        this.squatPhase = 'bottom';
                        this.repReachedMinDepth = true; 
                        if (DEBUG_MODE) console.log(`SQUAT_PHASE: **BOTTOM** (무릎 각도: ${kneeAngle.toFixed(2)}, 유지 프레임: ${this.bottomHoldFrames})`);
                    }
                } else if (kneeAngle > this.STANDING_KNEE_THRESHOLD) { // 스쿼트 취소 (다시 일어남)
                    this.squatPhase = 'standing';
                    this.frameCount = 0;
                    this.totalScores = { depth: 0, backPosture: 0, kneeAlignment: 0, control: 0 }; // 점수 초기화
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: standing (하강 취소, 무릎 각도: ${kneeAngle.toFixed(2)})`);
                }
                
                if (this.squatPhase === 'descending') { 
                    this.frameCount++;
                    this.totalScores.depth += depthScore;
                    this.totalScores.backPosture += backScore;
                    this.totalScores.kneeAlignment += kneeAlignmentScore;
                    this.totalScores.control += controlScore;
                }
                break;

            case 'bottom':
                this.bestKneeAngleInRep = Math.min(this.bestKneeAngleInRep, kneeAngle); // 최하점 유지
                if (kneeAngle > this.ASCENDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'ascending';
                    this.bottomHoldFrames = 0; 
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: **ASCENDING** (무릎 각도: ${kneeAngle.toFixed(2)})`);
                }
                
                this.frameCount++; 
                this.totalScores.depth += depthScore;
                this.totalScores.backPosture += backScore;
                this.totalScores.kneeAlignment += kneeAlignmentScore;
                this.totalScores.control += controlScore;
                break;

            case 'ascending':
                if (kneeAngle > this.STANDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'standing';
                    // 스쿼트 완료 조건 강화: 최소 깊이 도달, 최소 프레임 수, 그리고 최하점 각도 저장
                    if (this.repReachedMinDepth && this.frameCount >= this.MIN_SQUAT_DURATION_FRAMES && this.bestKneeAngleInRep <= this.BOTTOM_KNEE_THRESHOLD) {
                        squatCount++; // 전역 squatCount 증가
                        this.isSquatDetectedInVideo = true; // 영상 내 스쿼트 감지 플래그
                        if (DEBUG_MODE) console.log(`SQUAT_COUNT: 스쿼트 횟수 증가! 현재 횟수: ${squatCount}, 총 프레임: ${this.frameCount}`);
                    } else {
                        if (DEBUG_MODE) console.log(`SQUAT_COUNT: 스쿼트 횟수 증가 실패. repReachedMinDepth: ${this.repReachedMinDepth}, frameCount: ${this.frameCount}, bestKneeAngle: ${this.bestKneeAngleInRep.toFixed(2)}`);
                    }
                    this.repReachedMinDepth = false;
                    this.frameCount = 0;
                    this.totalScores = { depth: 0, backPosture: 0, kneeAlignment: 0, control: 0 };
                    this.bottomHoldFrames = 0;
                    this.bestKneeAngleInRep = 180;
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: standing (스쿼트 완료)`);
                }
                
                this.frameCount++; 
                this.totalScores.depth += depthScore;
                this.totalScores.backPosture += backScore;
                this.totalScores.kneeAlignment += kneeAlignmentScore;
                this.totalScores.control += controlScore;
                break;
        }

        if (DEBUG_MODE) {
            console.log(`FRAME_DATA: Phase: ${this.squatPhase}, Knee: ${kneeAngle.toFixed(2)}, Torso: ${torsoAngle.toFixed(2)}, DepthScore: ${depthScore.toFixed(0)}, BackScore: ${backScore.toFixed(0)}, KneeAlignScore: ${kneeAlignmentScore.toFixed(0)}, ControlScore: ${controlScore.toFixed(0)}, FrameCount: ${this.frameCount}, BottomHoldFrames: ${this.bottomHoldFrames}, HipY: ${hip.y.toFixed(2)}, KneeY: ${knee.y.toFixed(2)}, Velocity: ${velocity.toFixed(2)}, Quality: ${JSON.stringify(this.squatQualityChecks)}, BestKnee: ${this.bestKneeAngleInRep.toFixed(2)}`);
        }
    }
    // reset 메서드 추가: SquatAnalyzer 내부 상태를 초기화
    reset() {
        this.angleHistory = [];
        this.velocityHistory = [];
        this.squatPhase = 'standing';
        this.frameCount = 0;
        this.totalScores = { depth: 0, backPosture: 0, kneeAlignment: 0, control: 0 };
        this.repReachedMinDepth = false;
        this.bottomHoldFrames = 0;
        this.bestKneeAngleInRep = 180;
        this.squatQualityChecks = {
            hasProperDepth: false,
            hasControlledMovement: false,
            hasSymmetricMovement: false,
            hasGoodKneeAlignment: false
        };
        this.isSquatDetectedInVideo = false;
    }
}
   
async function createPoseLandmarker() {
    initialStatus.innerHTML = `<span class="loading"></span> AI 모델을 로딩 중입니다...`;
    try {
        const filesetResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
        poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1
        });
        initialStatus.textContent = 'AI 모델 준비 완료! 영상을 업로드해주세요.';
    } catch (error) {
        console.error("MODEL_LOAD_ERROR:", error);
        initialStatus.textContent = '❌ 모델 로딩 실패. 새로고침 후 다시 시도해주세요.';
    }
}

// DOMContentLoaded 이벤트 리스너
document.addEventListener('DOMContentLoaded', () => {
    squatAnalyzer = new SquatAnalyzer();
    createPoseLandmarker();
    // 초기에는 "이 영상으로 분석 시작하기" 버튼 비활성화 (영상 업로드 전)
    if (startAnalysisBtn) {
        startAnalysisBtn.disabled = true;
        startAnalysisBtn.textContent = "영상을 먼저 업로드해주세요.";
    }
    // AdSense 광고 로드 시도 (초기 페이지 로드 시)
    try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
        console.warn("AdSense push error on DOMContentLoaded:", e);
    }
});

function resetApp() {
    squatCount = 0;
    bestMomentTime = 0;
    lowestKneeAngle = 180;
    analysisStarted = false;
    
    if (squatAnalyzer) {
        squatAnalyzer.reset(); 
    }
    
    if (uploadSection) uploadSection.style.display = 'block';
    if (analysisSection) analysisSection.style.display = 'none';
    if (resultSection) resultSection.style.display = 'none';
    
    if (startAnalysisBtn) {
        startAnalysisBtn.disabled = true; // 리셋 시 다시 비활성화
        startAnalysisBtn.textContent = "영상을 먼저 업로드해주세요.";
    }
    
    if (video && video.src) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.style.display = 'none'; // 비디오 숨기기
    }
    
    if (canvasCtx && canvasElement) {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasElement.style.display = 'none'; // 캔버스 숨기기
    }
    
    if (initialStatus) initialStatus.textContent = 'AI 모델 준비 완료! 영상을 업로드해주세요.'; // 초기 상태 메시지 복원
    if (statusElement) statusElement.innerHTML = ''; 

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    // 광고 초기화 (필요하다면)
    // 일반적으로는 페이지 리로드 시 다시 로드되므로 특별히 할 필요는 없습니다.
}

function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (!file || !uploadSection || !analysisSection || !video || !canvasElement) return;

    uploadSection.style.display = 'none';
    analysisSection.style.display = 'block';
    
    const fileURL = URL.createObjectURL(file);
    video.src = fileURL;
    video.style.display = 'block'; // 비디오 보이기
    canvasElement.style.display = 'block'; // 캔버스 보이기
    video.play();

    // 영상 업로드 후 '분석 시작' 버튼 활성화
    if (startAnalysisBtn) {
        startAnalysisBtn.disabled = false;
        startAnalysisBtn.textContent = "이 영상으로 분석 시작하기 🔬";
    }

    // 업로드 상태 메시지 초기화
    if (initialStatus) initialStatus.textContent = ''; 
}

function setupVideoDisplay() {
    if (!video || !videoContainer || !canvasElement) return;
    
    const aspectRatio = video.videoWidth / video.videoHeight;
    let newWidth = videoContainer.clientWidth;
    let newHeight = newWidth / aspectRatio;

    videoContainer.style.height = `${newHeight}px`;
    canvasElement.width = newWidth;
    canvasElement.height = newHeight;
    video.height = newHeight; // 비디오 높이도 캔버스에 맞춤
    video.width = newWidth; // 비디오 너비도 캔버스에 맞춤
    
    previewLoop();
}

function previewLoop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (!video || video.paused || video.ended || !canvasCtx || !canvasElement) return;

    canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
    animationFrameId = requestAnimationFrame(previewLoop);
}

function startAnalysis() {
    if (!video || !startAnalysisBtn || !poseLandmarker) { // poseLandmarker 로딩 여부 확인
        updateStatus("AI 모델이 아직 준비되지 않았습니다. 잠시만 기다려주세요.");
        return;
    }
    
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    analysisStarted = true;
    updateStatus('🔬 분석 중...', true);
    startAnalysisBtn.disabled = true;
    startAnalysisBtn.textContent = "분석 중...";
    video.loop = false;
    video.currentTime = 0;
    video.pause(); // 분석 전에 잠시 멈춤
    
    // 분석 전 비디오 로드 완료 및 준비 대기 (seeked 이벤트 사용)
    const onVideoReadyForAnalysis = () => {
        video.removeEventListener('seeked', onVideoReadyForAnalysis);
        video.play();
        processVideoFrame(); 
    };
    video.addEventListener('seeked', onVideoReadyForAnalysis);
    video.currentTime = 0; // 비디오를 0초로 이동시켜 seeked 이벤트 트리거
}

async function endAnalysis() {
    updateStatus('✅ 분석 완료!');
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (analysisSection) analysisSection.style.display = 'none';
    if (resultSection) resultSection.style.display = 'block';

    if (squatCount > 0 || squatAnalyzer.isSquatDetectedInVideo) { // 한 번이라도 스쿼트 동작이 감지되었다면 결과 표시
        showRegularResults();
        
        // 최종 점수 계산 (가중치 적용)
        const frameCount = squatAnalyzer.frameCount || 1; // 0으로 나누는 것 방지
        const finalScores = {
            depth: Math.round(squatAnalyzer.totalScores.depth / frameCount),
            backPosture: Math.round(squatAnalyzer.totalScores.backPosture / frameCount),
            kneeAlignment: Math.round(squatAnalyzer.totalScores.kneeAlignment / frameCount),
            control: Math.round(squatAnalyzer.totalScores.control / frameCount)
        };
        
        // 가중치 적용: 깊이 40%, 등 자세 30%, 무릎 정렬 20%, 제어 10%
        const finalTotalScore = Math.round(
            (finalScores.depth * 0.4) +
            (finalScores.backPosture * 0.3) +
            (finalScores.kneeAlignment * 0.2) +
            (finalScores.control * 0.1)
        );

        // 상세 피드백 가져오기
        const { html: detailedFeedbackHtml, overallScore } = getDetailedFeedback({
            total: finalTotalScore,
            ...finalScores
        });
        
        await createShareableImage(overallScore, detailedFeedbackHtml); // 이미지 생성 시 최종 점수와 상세 HTML 피드백 전달
        if (feedbackList) feedbackList.innerHTML = detailedFeedbackHtml; // 피드백 영역에 HTML 삽입

    } else {
        showNoSquatResults(); // 스쿼트가 감지되지 않았을 때
    }

    // 광고 로드 시도 (분석 완료 후 결과 화면에서)
    try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
        console.warn("AdSense push error on endAnalysis:", e);
    }
}

function processVideoFrame() {
    if (!poseLandmarker || !video || video.ended || !canvasCtx || !canvasElement) {
        if (video && video.ended) endAnalysis();
        return;
    }

    // MediaPipe의 detectForVideo 함수는 내부적으로 requestAnimationFrame을 사용하므로,
    // 여기서 직접 requestAnimationFrame을 호출하는 대신 MediaPipe 콜백 체이닝을 활용합니다.
    let startTimeMs = performance.now();
    poseLandmarker.detectForVideo(video, startTimeMs, (result) => {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

        const drawingUtils = new DrawingUtils(canvasCtx);
        if (result.landmarks && result.landmarks.length > 0) {
            drawingUtils.drawLandmarks(result.landmarks[0], {color: '#FFC107', lineWidth: 2});
            drawingUtils.drawConnectors(result.landmarks[0], PoseLandmarker.POSE_CONNECTIONS, {color: '#FFFFFF', lineWidth: 2});
            
            // SquatAnalyzer의 메인 분석 함수 호출
            squatAnalyzer.analyzeBetterSquat(result.landmarks);

            // 최고의 순간 저장 (가장 낮은 무릎 각도)
            const currentKneeAngle = calculateAngle(result.landmarks[0][23], result.landmarks[0][25], result.landmarks[0][27]); // 엉덩이-무릎-발목 각도
            if (currentKneeAngle < lowestKneeAngle) {
                lowestKneeAngle = currentKneeAngle;
                bestMomentTime = video.currentTime;
            }
        } else {
            if (DEBUG_MODE) console.log("POSE_DETECTION_STATUS: 랜드마크가 감지되지 않음 (MediaPipe로부터 결과 없음).");
        }

        // 비디오가 끝나지 않았다면 다음 프레임 요청
        if (!video.ended) {
            animationFrameId = requestAnimationFrame(processVideoFrame);
        }
    });
}

// 이벤트 리스너들
videoUpload?.addEventListener('change', handleVideoUpload);
video?.addEventListener('loadedmetadata', setupVideoDisplay);
video?.addEventListener('ended', () => { if(video && !video.loop && analysisStarted) endAnalysis(); });
startAnalysisBtn?.addEventListener('click', (event) => { event.preventDefault(); startAnalysis(); });
resetBtn?.addEventListener('click', (event) => { event.preventDefault(); videoUpload.value = ''; resetApp(); });
shareStoryBtn?.addEventListener('click', (event) => { event.preventDefault();
    if (squatCount === 0 && !squatAnalyzer.isSquatDetectedInVideo) { // 스쿼트가 아예 감지되지 않았을 때
        alert("분석된 스쿼트가 없거나 유효한 자세가 감지되지 않아 결과 이미지를 다운로드할 수 없습니다.");
        return;
    }
    // createShareableImage 함수에서 이미 storyCanvas를 최신화했으므로 바로 다운로드
    const dataURL = storyCanvas?.toDataURL('image/png');
    if (dataURL) {
        const link = document.createElement('a');
        link.download = `squat-analysis-story-${Date.now()}.png`;
        link.href = dataURL;
        link.click();
    }
});
