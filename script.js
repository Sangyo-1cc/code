import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.12";

// --- (getElement 등 기존 변수 선언은 모두 동일합니다) ---
const getElement = (id) => {
    const element = document.getElementById(id);
    if (!element) console.warn(`Element with id '${id}' not found`);
    return element;
};
const videoUpload = getElement("videoUpload");
const video = getElement("analysisVideo");
// ... 나머지 모든 getElement 변수들 ...
const initialStatus = getElement('initial-status');
let poseLandmarker, squatCount = 0, bestMomentTime = 0, lowestKneeAngle = 180, animationFrameId, analysisStarted = false;
let squatAnalyzer;
const DEBUG_MODE = true;
// --- (여기까지는 기존과 동일) ---


// 🌟 [새로운 기능] 훨씬 안정적인 광고 로딩 함수 🌟
function loadAd(adContainer) {
    if (!adContainer || adContainer.hasAttribute('data-ad-loaded')) {
        // 컨테이너가 없거나, 이미 광고 로드를 시도했다면 실행하지 않음
        return;
    }

    // 광고 로드를 시도했음을 표시 (중복 실행 방지)
    adContainer.setAttribute('data-ad-loaded', 'true');

    let attempts = 0;
    const maxAttempts = 15; // 시도 횟수를 15번으로 늘림 (최대 1.5초 대기)

    const tryLoad = () => {
        // getBoundingClientRect().width가 너비를 가장 정확하게 가져옴
        const containerWidth = adContainer.getBoundingClientRect().width;
        
        if (containerWidth > 0) {
            console.log(`Ad container is visible (width: ${containerWidth}px), pushing ad.`);
            try {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
            } catch (e) {
                console.error("adsbygoogle.push() failed:", e);
            }
        } else if (attempts < maxAttempts) {
            // 너비가 아직 0이면, 0.1초 후에 다시 시도
            attempts++;
            console.log(`Ad container width is 0. Retrying... (Attempt ${attempts})`);
            setTimeout(tryLoad, 100);
        } else {
            console.error('Ad container failed to get a width after multiple attempts.');
        }
    };
    
    // 최초 시도
    tryLoad();
}


// --- (calculateAngle 등 기존 유틸리티 함수는 모두 동일합니다) ---
function calculateAngle(point1, point2, point3) { /* ... 기존 코드 ... */ }
function updateStatus(message, isLoading = false) { /* ... 기존 코드 ... */ }
function showRegularResults() { /* ... 기존 코드 ... */ }
function showNoSquatResults() { /* ... 기존 코드 ... */ }
function getDetailedFeedback(scores) { /* ... 기존 코드 ... */ }
async function createShareableImage(finalScore, detailedFeedbackHtml) { /* ... 기존 코드 ... */ }
function wrapText(context, text, x, y, maxWidth, lineHeight) { /* ... 기존 코드 ... */ }
// --- (여기까지는 기존과 동일) ---


// --- (SquatAnalyzer 클래스는 모두 동일합니다) ---
class SquatAnalyzer { /* ... 기존 코드 전체 ... */ }


// --- (createPoseLandmarker 등 핵심 함수들) ---
async function createPoseLandmarker() { /* ... 기존 코드 ... */ }

document.addEventListener('DOMContentLoaded', () => {
    squatAnalyzer = new SquatAnalyzer();
    createPoseLandmarker();
    if (startAnalysisBtn) {
        startAnalysisBtn.disabled = true;
        startAnalysisBtn.textContent = "영상을 먼저 업로드해주세요.";
    }
});

function resetApp() { /* ... 기존 코드 ... */ }

// 🌟 [수정됨] handleVideoUpload 함수 🌟
function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    uploadSection.style.display = 'none';
    analysisSection.style.display = 'block';
    
    const fileURL = URL.createObjectURL(file);
    video.src = fileURL;
    video.style.display = 'block'; 
    canvasElement.style.display = 'block'; 
    video.play();

    if (startAnalysisBtn) {
        startAnalysisBtn.disabled = false;
        startAnalysisBtn.textContent = "이 영상으로 분석 시작하기 🔬";
    }
    if (initialStatus) initialStatus.textContent = '';

    // 새로운 스마트 광고 로딩 함수 호출
    loadAd(analysisSection.querySelector('.adsbygoogle'));
}

function setupVideoDisplay() { /* ... 기존 코드 ... */ }
function previewLoop() { /* ... 기존 코드 ... */ }
function startAnalysis() { /* ... 기존 코드 ... */ }

// 🌟 [수정됨] endAnalysis 함수 🌟
async function endAnalysis() {
    updateStatus('✅ 분석 완료!');
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (analysisSection) analysisSection.style.display = 'none';
    if (resultSection) resultSection.style.display = 'block';

    if (squatCount > 0 || squatAnalyzer.isSquatDetectedInVideo) { 
        // ... (점수 계산 및 시트 저장 로직은 기존과 동일) ...
        showRegularResults();
        const frameCount = squatAnalyzer.frameCount || 1;
        const finalScores = {
            depth: Math.round(squatAnalyzer.totalScores.depth / frameCount),
            backPosture: Math.round(squatAnalyzer.totalScores.backPosture / frameCount),
            kneeAlignment: Math.round(squatAnalyzer.totalScores.kneeAlignment / frameCount),
            control: Math.round(squatAnalyzer.totalScores.control / frameCount)
        };
        const finalTotalScore = Math.round((finalScores.depth * 0.4) + (finalScores.backPosture * 0.3) + (finalScores.kneeAlignment * 0.2) + (finalScores.control * 0.1));
        const { html: detailedFeedbackHtml, overallScore } = getDetailedFeedback({total: finalTotalScore, ...finalScores});
        await createShareableImage(overallScore, detailedFeedbackHtml);
        if (feedbackList) feedbackList.innerHTML = detailedFeedbackHtml;
        const dataToLog = { squatCount, totalScore: finalTotalScore, depthScore: finalScores.depth, backPosture: finalScores.backPosture };
        updateStatus('📊 분석 결과를 구글 시트에 저장 중...', true);
        google.script.run
            .withSuccessHandler(response => { console.log(response); updateStatus('✅ 분석 완료! 결과가 시트에 저장되었습니다.'); })
            .withFailureHandler(error => { console.error(error.message); alert('결과를 시트에 저장하는 데 실패했습니다: ' + error.message); updateStatus('⚠️ 분석 완료! (시트 저장 실패)'); })
            .logSquatData(dataToLog);
    } else {
        showNoSquatResults(); 
    }

    // 새로운 스마트 광고 로딩 함수 호출
    loadAd(resultSection.querySelector('.adsbygoogle'));
}

function processVideoFrame() { /* ... 기존 코드 ... */ }

// --- (이벤트 리스너들은 모두 동일합니다) ---
videoUpload?.addEventListener('change', handleVideoUpload);
video?.addEventListener('loadedmetadata', setupVideoDisplay);
// ... 나머지 이벤트 리스너들 ...
shareStoryBtn?.addEventListener('click', (event) => { /* ... 기존 코드 ... */ });
