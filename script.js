import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.12";

const videoUpload = document.getElementById("videoUpload"), video = document.getElementById("analysisVideo"), canvasElement = document.getElementById("output_canvas"), canvasCtx = canvasElement.getContext("2d"), videoContainer = document.getElementById("videoContainer"), statusElement = document.getElementById("status"), feedbackList = document.getElementById("feedbackList"), shareStoryBtn = document.getElementById("shareStoryBtn"), uploadSection = document.getElementById('upload-section'), analysisSection = document.getElementById('analysis-section'), resultSection = document.getElementById('result-section'), storyCanvas = document.getElementById('story-canvas'), storyCtx = storyCanvas.getContext('2d'), coachFeedbackArea = document.getElementById('coach-feedback-area'), storyCanvasContainer = document.getElementById('story-canvas-container'), startAnalysisBtn = document.getElementById('startAnalysisBtn'), resetBtn = document.getElementById('resetBtn'), noSquatResultArea = document.getElementById('no-squat-result-area'), initialStatus = document.getElementById('initial-status');

// 스쿼트 분석 관련 변수
let poseLandmarker, squatCount = 0, squatPhase = 'standing', frameCount = 0, totalScores = { depth: 0, backPosture: 0 }, bestMomentTime = 0, lowestKneeAngle = 180, animationFrameId, repReachedMinDepth = false, analysisStarted = false, bottomHoldFrames = 0; // totalScores 초기값 설정

function showRegularResults() {
    if(storyCanvasContainer) storyCanvasContainer.style.display = 'block';
    if(noSquatResultArea) noSquatResultArea.style.display = 'none';
    if(coachFeedbackArea) coachFeedbackArea.style.display = 'block';
    if(shareStoryBtn) shareStoryBtn.style.display = 'block';
}

function showNoSquatResults() {
    if(storyCanvasContainer) storyCanvasContainer.style.display = 'none';
    if(noSquatResultArea) {
        noSquatResultArea.innerHTML = `<h2>분석 실패! 🤖</h2><p style="margin-top: 20px;">유효한 스쿼트 동작을 인식하지 못했습니다.</p><p>자세나 영상 각도를 확인 후 다시 시도해보세요.</p>`;
        noSquatResultArea.style.display = 'block';
    }
    if(coachFeedbackArea) coachFeedbackArea.style.display = 'none';
    if(shareStoryBtn) shareStoryBtn.style.display = 'none';
}

function getQualitativeFeedback(score) {
    if (score >= 90) return "완벽에 가까운 스쿼트! 자세 교본으로 써도 되겠어요. 👏";
    if (score >= 80) return "훌륭해요! 안정적인 자세가 돋보입니다. 여기서 만족하지 않으실 거죠? 😉";
    if (score >= 70) return "좋아요! 기본기가 탄탄하시네요. 조금만 더 깊이에 신경 쓰면 완벽할 거예요.";
    if (score >= 50) return "잘하고 있어요! 조금만 더 꾸준히 하면 금방 좋아질 거예요. 화이팅!";
    if (score >= 30) return "음, 이게 스쿼트일까요? 🕺 열정은 100점! 자세는 우리와 함께 만들어가요!";
    return "앗, 앉으려다 마신 건 아니죠? 😅 괜찮아요, 모든 시작은 미약하니까요!";
}

async function createShareableImage(finalScore, qualitativeFeedback) {
    if (!video.duration || !video.videoWidth || !video.videoHeight) return;
    storyCanvas.style.display = 'block';
    const tempVideoCanvas = document.createElement('canvas');
    const tempVideoCtx = tempVideoCanvas.getContext('2d');

    video.currentTime = bestMomentTime;
    await new Promise(resolve => { video.onseeked = resolve; });
    
    tempVideoCanvas.width = video.videoWidth;
    tempVideoCanvas.height = video.videoHeight;
    tempVideoCtx.drawImage(video, 0, 0, tempVideoCanvas.width, tempVideoCtx.height);

    const storyWidth = 1080, storyHeight = 1920;
    storyCanvas.width = storyWidth;
    storyCanvas.height = storyHeight;

    storyCtx.fillStyle = '#1a1a1a';
    storyCtx.fillRect(0, 0, storyWidth, storyHeight);

    const gradient = storyCtx.createLinearGradient(0, 0, 0, storyHeight);
    gradient.addColorStop(0, 'rgba(0,0,0,0.6)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.8)');
    storyCtx.fillStyle = gradient;
    storyCtx.fillRect(0, 0, storyWidth, storyHeight);

    const videoAspectRatio = tempVideoCanvas.width / tempVideoCanvas.height;
    const outputWidth = storyWidth;
    const outputHeight = outputWidth / videoAspectRatio;
    const yPos = (storyHeight - outputHeight) / 2.5;

    storyCtx.drawImage(tempVideoCanvas, 0, yPos, outputWidth, outputHeight);

    storyCtx.font = 'bold 120px "Noto Sans KR", sans-serif';
    storyCtx.fillStyle = 'white';
    storyCtx.textAlign = 'center';
    storyCtx.shadowColor = 'rgba(0,0,0,0.5)';
    storyCtx.shadowBlur = 10;
    storyCtx.fillText('✨ 최고의 순간 ✨', storyWidth / 2, yPos - 50);

    storyCtx.font = 'bold 250px "Noto Sans KR", sans-serif';
    storyCtx.fillStyle = '#FFC107';
    storyCtx.fillText(finalScore, storyWidth / 2, storyHeight - 350);

    storyCtx.font = '60px "Noto Sans KR", sans-serif';
    storyCtx.fillStyle = 'white';
    storyCtx.fillText('/100', storyWidth / 2 + 250, storyHeight - 350);

    storyCtx.shadowBlur = 0;
    storyCtx.font = '55px "Noto Sans KR", sans-serif';
    wrapText(storyCtx, qualitativeFeedback, storyWidth / 2, storyHeight - 200, storyWidth - 100, 70);
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

function updateStatus(message, isLoading = false) {
    if (statusElement) statusElement.innerHTML = isLoading ? `<span class="loading"></span> ${message}` : message;
}

function calculateAngle(a, b, c) {
    const r = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let ang = Math.abs(r * 180.0 / Math.PI);
    if (ang > 180.0) ang = 360 - ang;
    return ang;
}

// 스쿼트 분석 로직 (상태 머신 재구조화)
function analyzeSquat(landmarks) {
    const requiredLandmarks = [11, 12, 23, 24, 25, 26, 27, 28]; // 어깨(11,12), 엉덩이(23,24), 무릎(25,26), 발목(27,28)

    if (!landmarks || landmarks.length === 0 || !landmarks[0]) {
        console.warn("LANDMARK_STATUS: 랜드마크 데이터 없음. 스쿼트 분석 건너뜀.");
        return;
    }
    const pose = landmarks[0];

    for (let i = 0; i < requiredLandmarks.length; i++) {
        // 필수 랜드마크가 없거나 가시성이 낮을 경우 경고 출력 및 분석 건너뛰기
        // 가시성 임계값 0.6 -> 0.3으로 대폭 완화
        if (!pose[requiredLandmarks[i]] || pose[requiredLandmarks[i]].visibility < 0.3) { 
            console.warn(`LANDMARK_STATUS: 필수 랜드마크 ${requiredLandmarks[i]}번이 감지되지 않거나 가시성(${pose[requiredLandmarks[i]]?.visibility.toFixed(2)})이 낮음. 스쿼트 분석 건너뛰기`);
            return;
        }
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
    const shoulder = {x:(leftShoulder.x + rightShoulder.x)/2, y:(leftShoulder.y + rightShoulder.y)/2};

    const kneeAngle = (calculateAngle(hip, knee, ankle)); 

    const vertical = { x: hip.x, y: hip.y - 1 };
    const torsoAngle = calculateAngle(shoulder, hip, vertical);

    if (kneeAngle < lowestKneeAngle) {
        lowestKneeAngle = kneeAngle;
        bestMomentTime = video.currentTime;
    }

    let depthScore = 0;
    if (kneeAngle <= 90) depthScore = 100;
    else if (kneeAngle <= 110) depthScore = Math.max(0, 100 - (kneeAngle - 90) * 2.5);
    else depthScore = Math.max(0, 50 - (kneeAngle - 110) * 1.5);
    
    let backScore = 0;
    const idealTorsoMin = 10;
    const idealTorsoMax = 50;
    
    if (torsoAngle >= idealTorsoMin && torsoAngle <= idealTorsoMax) {
        backScore = 100;
    } else if (torsoAngle < idealTorsoMin) {
        backScore = Math.max(0, 100 - (idealTorsoMin - torsoAngle) * 5);
    } else {
        backScore = Math.max(0, 100 - (torsoAngle - idealTorsoMax) * 3);
    }

    // 스쿼트 상태 머신 임계값
    const STANDING_KNEE_THRESHOLD = 155; 
    const DESCENDING_KNEE_THRESHOLD = 150; 
    const BOTTOM_KNEE_THRESHOLD = 140;     
    const ASCENDING_KNEE_THRESHOLD = 135; 

    const MIN_SQUAT_DURATION_FRAMES = 5; 
    const MIN_BOTTOM_HOLD_FRAMES = 1;    
    
    // 상태 머신 로직
    switch (squatPhase) {
        case 'standing':
            // 무릎 각도 조건만으로 하강 진입 시도 (hip.y > knee.y 조건 제거)
            if (kneeAngle <= DESCENDING_KNEE_THRESHOLD) { 
                squatPhase = 'descending';
                frameCount = 0;
                bottomHoldFrames = 0;
                repReachedMinDepth = false; 
                totalScores = { depth: 0, backPosture: 0 }; 
                console.log(`SQUAT_PHASE: **DESCENDING** (무릎 각도: ${kneeAngle.toFixed(2)})`);
            } else {
                 console.log(`DEBUG_STANDING: Standing. Knee: ${kneeAngle.toFixed(2)}, DescendingThresh: ${DESCENDING_KNEE_THRESHOLD}`);
            }
            break;

        case 'descending':
            if (kneeAngle <= BOTTOM_KNEE_THRESHOLD) {
                bottomHoldFrames++;
                if (bottomHoldFrames >= MIN_BOTTOM_HOLD_FRAMES) { 
                    squatPhase = 'bottom';
                    repReachedMinDepth = true; 
                    console.log(`SQUAT_PHASE: **BOTTOM** (무릎 각도: ${kneeAngle.toFixed(2)}, 유지 프레임: ${bottomHoldFrames})`);
                }
            } else if (kneeAngle > STANDING_KNEE_THRESHOLD) { 
                squatPhase = 'standing';
                console.log(`SQUAT_PHASE: standing (하강 취소, 무릎 각도: ${kneeAngle.toFixed(2)})`);
            }
            
            if (squatPhase === 'descending') { 
                frameCount++;
                totalScores.depth += depthScore;
                totalScores.backPosture += backScore;
            }
            break;

        case 'bottom':
            if (kneeAngle > ASCENDING_KNEE_THRESHOLD) {
                squatPhase = 'ascending';
                bottomHoldFrames = 0; 
                console.log(`SQUAT_PHASE: **ASCENDING** (무릎 각도: ${kneeAngle.toFixed(2)})`);
            }
            
            frameCount++; 
            totalScores.depth += depthScore;
            totalScores.backPosture += backScore;
            break;

        case 'ascending':
            if (kneeAngle > STANDING_KNEE_THRESHOLD) {
                squatPhase = 'standing';
                if (repReachedMinDepth && frameCount >= MIN_SQUAT_DURATION_FRAMES) {
                    squatCount++;
                    console.log(`SQUAT_COUNT: 스쿼트 횟수 증가! 현재 횟수: ${squatCount}, 총 프레임: ${frameCount}`);
                } else {
                    console.log(`SQUAT_COUNT: 스쿼트 횟수 증가 실패. repReachedMinDepth: ${repReachedMinDepth}, frameCount: ${frameCount}`);
                }
                repReachedMinDepth = false;
                frameCount = 0;
                totalScores = { depth: 0, backPosture: 0 };
                bottomHoldFrames = 0;
                console.log(`SQUAT_PHASE: standing (스쿼트 완료)`);
            }
            
            frameCount++; 
            totalScores.depth += depthScore;
            totalScores.backPosture += backScore;
            break;
    }

    console.log(`FRAME_DATA: Phase: ${squatPhase}, Knee: ${kneeAngle.toFixed(2)}, Torso: ${torsoAngle.toFixed(2)}, DepthScore: ${depthScore.toFixed(0)}, BackScore: ${backScore.toFixed(0)}, FrameCount: ${frameCount}, BottomHoldFrames: ${bottomHoldFrames}, HipY: ${hip.y.toFixed(2)}, KneeY: ${knee.y.toFixed(2)}`);
}
   
async function createPoseLandmarker() {
    initialStatus.innerHTML = `<span class="loading"></span> AI 모델을 로딩중입니다...`;
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
        initialStatus.textContent = 'AI 모델 준비 완료!';
    } catch (error) {
        console.error("MODEL_LOAD_ERROR:", error);
        initialStatus.textContent = '❌ 모델 로딩 실패. 새로고침 해주세요.';
    }
}

function resetApp() {
    squatCount = 0;
    frameCount = 0;
    squatPhase = 'standing';
    bestMomentTime = 0;
    lowestKneeAngle = 180;
    repReachedMinDepth = false;
    analysisStarted = false;
    bottomHoldFrames = 0; 
    uploadSection.style.display = 'block';
    analysisSection.style.display = 'none';
    resultSection.style.display = 'none';
    startAnalysisBtn.disabled = false;
    startAnalysisBtn.textContent = "이 영상으로 분석 시작하기 🔬";
    if(video.src) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    initialStatus.textContent = '';
    statusElement.innerHTML = ''; 
}

function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    uploadSection.style.display = 'none';
    analysisSection.style.display = 'block';
    
    const fileURL = URL.createObjectURL(file);
    video.src = fileURL;
    video.play();
}

function setupVideoDisplay() {
    const aspectRatio = video.videoWidth / video.videoHeight;
    let newWidth = videoContainer.clientWidth;
    let newHeight = newWidth / aspectRatio;

    videoContainer.style.height = `${newHeight}px`;
    canvasElement.width = newWidth;
    canvasElement.height = newHeight;
    
    previewLoop();
}

function previewLoop() {
    if (animationFrameId) cancelAnimationFrame(animationId);
    if (video.paused || video.ended) return;

    canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
    animationFrameId = requestAnimationFrame(previewLoop);
}

function startAnalysis() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    analysisStarted = true;
    updateStatus('🔬 분석 중...', true);
    startAnalysisBtn.disabled = true;
    startAnalysisBtn.textContent = "분석 중...";
    video.loop = false;
    video.currentTime = 0;
    video.play(); 
    processVideoFrame(); 
}

async function endAnalysis() {
    updateStatus('✅ 분석 완료!');
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    analysisSection.style.display = 'none';
    resultSection.style.display = 'block';

    if (squatCount > 0) { 
        showRegularResults();
        const finalScores = {
            depth: Math.round(totalScores.depth / frameCount),
            backPosture: Math.round(totalScores.backPosture / frameCount)
        };
        const finalTotalScore = Math.round((finalScores.depth + finalScores.backPosture) / 2);
        const qualitativeFeedback = getQualitativeFeedback(finalTotalScore);
        
        await createShareableImage(finalTotalScore, qualitativeFeedback);
        feedbackList.textContent = qualitativeFeedback;

    } else {
        showNoSquatResults();
    }
}

function processVideoFrame() {
    if (!poseLandmarker || video.ended) {
        if (video.ended) endAnalysis();
        return;
    }

    poseLandmarker.detectForVideo(video, performance.now(), (result) => {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

        const drawingUtils = new DrawingUtils(canvasCtx);
        if (result.landmarks && result.landmarks.length > 0) {
            drawingUtils.drawLandmarks(result.landmarks[0], {color: '#FFC107', lineWidth: 2});
            drawingUtils.drawConnectors(result.landmarks[0], PoseLandmarker.POSE_CONNECTIONS, {color: '#FFFFFF', lineWidth: 2});
            analyzeSquat(result.landmarks);
        } else {
            console.log("POSE_DETECTION_STATUS: 랜드마크가 감지되지 않음 (MediaPipe로부터 결과 없음).");
        }
    });
    animationFrameId = requestAnimationFrame(processVideoFrame);
}

videoUpload.addEventListener('change', handleVideoUpload);
video.addEventListener('loadedmetadata', setupVideoDisplay);
video.addEventListener('ended', () => { if(!video.loop && analysisStarted) endAnalysis(); });
startAnalysisBtn.addEventListener('click', (event) => { event.preventDefault(); startAnalysis(); });
resetBtn.addEventListener('click', (event) => { event.preventDefault(); videoUpload.value = ''; resetApp(); });
shareStoryBtn.addEventListener('click', (event) => { event.preventDefault();
    if (squatCount === 0) {
        alert("스쿼트가 감지되지 않아 결과 이미지를 다운로드할 수 없습니다.");
        return;
    }
    const dataURL = storyCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `squat-analysis-story-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
});
document.addEventListener('DOMContentLoaded', createPoseLandmarker);
