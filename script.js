// 전역 변수
let pose = null;
let uploadedVideo = null;
let analyzeResults = {
    scores: {
        depth: 0,
        posture: 0,
        balance: 0,
        speed: 0,
        overall: 0
    },
    feedback: []
};
let frameAnalysisData = [];
let isAnalyzing = false;
let poseInitialized = false;
let squatCount = 0;
let squatPhase = 'standing'; // standing, descending, bottom, ascending

// 최고의 순간 저장용 변수
let bestMomentTime = 0;
let lowestKneeAngle = 180;
let bestMomentCanvas = null;

// 디버그 모드
const DEBUG_MODE = true;
const log = (message, data = null) => {
    if (DEBUG_MODE) {
        const timestamp = new Date().toTimeString().split(' ')[0];
        console.log(`[${timestamp}] [AI Squat] ${message}`, data || '');
        updateDebugPanel(`${timestamp} - ${message}`);
    }
};

// 디버그 패널 업데이트
function updateDebugPanel(message) {
    const panel = document.getElementById('debugPanel');
    if (DEBUG_MODE && panel) {
        panel.classList.add('show');
        panel.innerHTML = message + '<br>' + panel.innerHTML;
        const lines = panel.innerHTML.split('<br>');
        if (lines.length > 10) {
            panel.innerHTML = lines.slice(0, 10).join('<br>');
        }
    }
}

// MediaPipe Pose 초기화
async function initializePose() {
    if (poseInitialized) {
        log('Pose 이미 초기화됨');
        return true;
    }

    log('Pose 초기화 시작');
    
    try {
        // Pose 인스턴스 생성
        pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
            }
        });

        // 옵션 설정
        pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        // 결과 콜백 설정
        pose.onResults(onPoseResults);
        
        poseInitialized = true;
        log('Pose 초기화 완료');
        return true;
        
    } catch (error) {
        console.error('[AI Squat] Pose 초기화 실패:', error);
        poseInitialized = false;
        return false;
    }
}

// 파일 업로드 이벤트 초기화
function initializeUpload() {
    const videoInput = document.getElementById('videoInput');
    const uploadArea = document.getElementById('uploadArea');
    
    if (uploadArea) {
        // 클릭 이벤트 - 모바일 터치 지원
        uploadArea.addEventListener('click', (e) => {
            e.preventDefault();
            videoInput.click();
        });
        
        // 모바일 터치 이벤트 추가
        uploadArea.addEventListener('touchend', (e) => {
            e.preventDefault();
            videoInput.click();
        });
        
        // 드래그 앤 드롭
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('video/')) {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(files[0]);
                videoInput.files = dataTransfer.files;
                handleFileUpload({ target: { files: files } });
            }
        });
    }
    
    if (videoInput) {
        videoInput.addEventListener('change', handleFileUpload);
    }
}

// 파일 업로드 처리
function handleFileUpload(event) {
    const file = event.target.files[0];
    log('파일 업로드 시도', { 
        fileName: file?.name, 
        fileSize: file ? `${(file.size / 1024 / 1024).toFixed(2)}MB` : 'N/A', 
        fileType: file?.type 
    });
    
    if (!file || !file.type.startsWith('video/')) {
        console.error('[AI Squat] 잘못된 파일 형식:', file?.type);
        alert('비디오 파일을 선택해주세요.');
        return;
    }

    const videoPreview = document.getElementById('videoPreview');
    const video = document.getElementById('uploadedVideo');
    
    if (!video) {
        console.error('[AI Squat] 비디오 엘리먼트를 찾을 수 없습니다');
        return;
    }
    
    // 기존 비디오 URL 정리
    if (video.src && video.src.startsWith('blob:')) {
        URL.revokeObjectURL(video.src);
    }
    
    const videoURL = URL.createObjectURL(file);
    video.src = videoURL;
    
    if (videoPreview) {
        videoPreview.style.display = 'block';
    }
    
    video.onloadedmetadata = () => {
        log('비디오 메타데이터 로드 완료', {
            duration: `${video.duration.toFixed(1)}초`,
            resolution: `${video.videoWidth}x${video.videoHeight}`,
            readyState: video.readyState
        });
        
        const analyzeBtn = document.getElementById('analyzeBtn');
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
        }
        updateStep(1);
    };
    
    video.onerror = (e) => {
        console.error('[AI Squat] 비디오 로드 실패:', e);
        alert('비디오 파일을 읽을 수 없습니다. 다른 파일을 선택해주세요.');
    };
}

// 분석 시작
async function startAnalysis() {
    if (isAnalyzing) {
        log('이미 분석 중입니다');
        return;
    }
    
    uploadedVideo = document.getElementById('uploadedVideo');
    if (!uploadedVideo || !uploadedVideo.src) {
        alert('비디오를 먼저 업로드해주세요.');
        return;
    }
    
    isAnalyzing = true;
    log('=== 분석 시작 ===');
    
    // 최고의 순간 초기화
    bestMomentTime = 0;
    lowestKneeAngle = 180;
    bestMomentCanvas = null;
    
    try {
        // UI 전환
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('analyzingSection').style.display = 'block';
        updateStep(2);

        // 캔버스 설정
        const canvas = document.getElementById('outputCanvas');
        const canvasCtx = canvas.getContext('2d');
        
        // 비디오 준비 확인
        if (uploadedVideo.readyState < 2) {
            log('비디오 로딩 대기 중...');
            await new Promise((resolve) => {
                uploadedVideo.addEventListener('loadeddata', resolve, { once: true });
            });
        }
        
        canvas.width = uploadedVideo.videoWidth;
        canvas.height = uploadedVideo.videoHeight;
        log('캔버스 설정 완료', { 
            width: canvas.width, 
            height: canvas.height
        });

        // Pose 초기화 확인
        if (!poseInitialized || !pose) {
            log('Pose 재초기화 필요');
            const initialized = await initializePose();
            if (!initialized) {
                throw new Error('Pose 초기화 실패');
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 분석 데이터 초기화
        frameAnalysisData = [];
        squatCount = 0;
        squatPhase = 'standing';
        const fps = 2; // 초당 2프레임
        const totalFrames = Math.floor(uploadedVideo.duration * fps);
        let processedFrames = 0;

        log('분석 파라미터', {
            총시간: `${uploadedVideo.duration.toFixed(1)}초`,
            FPS: fps,
            총프레임: totalFrames
        });

        // 상태 업데이트
        const analysisStatus = document.getElementById('analysisStatus');
        const frameInfo = document.getElementById('frameInfo');
        const progressFill = document.getElementById('progressFill');
        
        if (analysisStatus) {
            analysisStatus.textContent = '포즈 인식을 시작합니다...';
        }

        // 비디오 분석 루프
        for (let i = 0; i < totalFrames; i++) {
            const currentTime = i / fps;
            
            if (currentTime >= uploadedVideo.duration) {
                break;
            }
            
            try {
                // 비디오 시간 설정
                await new Promise((resolve) => {
                    uploadedVideo.currentTime = currentTime;
                    
                    const seekHandler = () => {
                        uploadedVideo.removeEventListener('seeked', seekHandler);
                        resolve();
                    };
                    
                    uploadedVideo.addEventListener('seeked', seekHandler);
                    
                    setTimeout(() => {
                        uploadedVideo.removeEventListener('seeked', seekHandler);
                        resolve();
                    }, 1000);
                });
                
                // 캔버스에 그리기
                canvasCtx.drawImage(uploadedVideo, 0, 0, canvas.width, canvas.height);
                
                // Pose 분석
                if (pose && pose.send) {
                    await pose.send({ image: canvas });
                }
                
                processedFrames++;
                
                // UI 업데이트
                const progress = (processedFrames / totalFrames) * 100;
                if (progressFill) {
                    progressFill.style.width = `${progress}%`;
                }
                if (frameInfo) {
                    frameInfo.textContent = `프레임 ${processedFrames}/${totalFrames} 분석 중...`;
                }
                if (analysisStatus && squatCount > 0) {
                    analysisStatus.textContent = `스쿼트 ${squatCount}회 감지됨`;
                }
                
                // CPU 과부하 방지
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                log(`프레임 ${i} 처리 오류: ${error.message}`);
                continue;
            }
        }

        // 분석 완료 대기
        await new Promise(resolve => setTimeout(resolve, 500));

        log('=== 분석 완료 ===', {
            처리프레임: processedFrames,
            감지프레임: frameAnalysisData.length,
            스쿼트횟수: squatCount,
            감지율: frameAnalysisData.length > 0 ? 
                `${((frameAnalysisData.length / processedFrames) * 100).toFixed(1)}%` : '0%'
        });

        // 결과 계산
        if (frameAnalysisData.length > 0) {
            calculateFinalScores();
        } else {
            // 감지 실패 시 기본 점수
            analyzeResults.scores = {
                depth: 60,
                posture: 60,
                balance: 60,
                speed: 60,
                overall: 60
            };
            generateFeedback({ knee: 120, hip: 90, back: 85 }, analyzeResults.scores);
        }

        // 결과 표시
        setTimeout(() => {
            isAnalyzing = false;
            showResults();
        }, 1000);
        
    } catch (error) {
        console.error('[AI Squat] 분석 오류:', error);
        alert(`분석 중 오류가 발생했습니다:\n${error.message}`);
        isAnalyzing = false;
        resetAnalysis();
    }
}

// Pose 결과 처리
function onPoseResults(results) {
    try {
        if (!results || !results.poseLandmarks) {
            return;
        }

        const landmarks = results.poseLandmarks;
        
        // 필요한 랜드마크 확인 (MediaPipe Pose 랜드마크 인덱스)
        // 11: 왼쪽 어깨, 12: 오른쪽 어깨
        // 23: 왼쪽 엉덩이, 24: 오른쪽 엉덩이
        // 25: 왼쪽 무릎, 26: 오른쪽 무릎
        // 27: 왼쪽 발목, 28: 오른쪽 발목
        if (!landmarks[11] || !landmarks[23] || !landmarks[25] || !landmarks[27]) {
            log('필요한 랜드마크 누락');
            return;
        }
        
        // 가시성 체크
        const minVisibility = 0.3;
        if (landmarks[25].visibility < minVisibility || 
            landmarks[27].visibility < minVisibility) {
            return;
        }
        
        // 각도 계산
        const angles = calculateAngles(landmarks);
        
        // 유효성 검증
        if (angles.knee < 30 || angles.knee > 180 || isNaN(angles.knee)) {
            return;
        }
        
        // 최고의 순간 캡처 (무릎 각도가 가장 작을 때)
        if (angles.knee < lowestKneeAngle) {
            lowestKneeAngle = angles.knee;
            bestMomentTime = uploadedVideo.currentTime;
            
            // 현재 프레임 캡처
            const canvas = document.getElementById('outputCanvas');
            bestMomentCanvas = document.createElement('canvas');
            bestMomentCanvas.width = canvas.width;
            bestMomentCanvas.height = canvas.height;
            const ctx = bestMomentCanvas.getContext('2d');
            ctx.drawImage(canvas, 0, 0);
            
            log('최고의 순간 업데이트', {
                시간: bestMomentTime.toFixed(2),
                무릎각도: lowestKneeAngle.toFixed(1)
            });
        }
        
        // 스쿼트 단계 감지
        detectSquatPhase(angles.knee);
        
        log('포즈 감지 성공', {
            무릎각도: angles.knee.toFixed(1),
            스쿼트단계: squatPhase,
            프레임: frameAnalysisData.length + 1
        });
        
        // 데이터 저장
        frameAnalysisData.push({
            timestamp: uploadedVideo?.currentTime || 0,
            angles: angles,
            landmarks: landmarks,
            phase: squatPhase
        });
        
    } catch (error) {
        console.error('[AI Squat] Pose 결과 처리 오류:', error);
    }
}

// 스쿼트 단계 감지 (완화된 기준)
function detectSquatPhase(kneeAngle) {
    const STANDING_THRESHOLD = 150;  // 서있는 상태
    const DESCENDING_THRESHOLD = 140; // 내려가기 시작
    const BOTTOM_THRESHOLD = 110;     // 바닥 (완화된 기준)
    const ASCENDING_THRESHOLD = 120;  // 올라가기 시작
    
    switch (squatPhase) {
        case 'standing':
            if (kneeAngle < DESCENDING_THRESHOLD) {
                squatPhase = 'descending';
            }
            break;
            
        case 'descending':
            if (kneeAngle < BOTTOM_THRESHOLD) {
                squatPhase = 'bottom';
            } else if (kneeAngle > STANDING_THRESHOLD) {
                squatPhase = 'standing';
            }
            break;
            
        case 'bottom':
            if (kneeAngle > ASCENDING_THRESHOLD) {
                squatPhase = 'ascending';
            }
            break;
            
        case 'ascending':
            if (kneeAngle > STANDING_THRESHOLD) {
                squatPhase = 'standing';
                squatCount++; // 한 사이클 완료
                log('스쿼트 완료!', { 총횟수: squatCount });
            }
            break;
    }
}

// 최종 점수 계산
function calculateFinalScores() {
    log('최종 점수 계산 시작', { 
        총프레임수: frameAnalysisData.length,
        스쿼트횟수: squatCount
    });

    if (frameAnalysisData.length === 0) {
        analyzeResults.scores = {
            depth: 60,
            posture: 60,
            balance: 60,
            speed: 60,
            overall: 60
        };
        return;
    }

    // 가장 깊은 스쿼트 찾기
    let bestDepthFrame = frameAnalysisData[0];
    let minKneeAngle = 180;
    
    frameAnalysisData.forEach(frame => {
        if (frame.angles.knee < minKneeAngle) {
            minKneeAngle = frame.angles.knee;
            bestDepthFrame = frame;
        }
    });

    log('최고 깊이 프레임', {
        무릎각도: minKneeAngle.toFixed(1),
        시간: bestDepthFrame.timestamp.toFixed(2)
    });

    // 점수 계산
    const depthScore = calculateDepthScore(minKneeAngle);
    const postureScore = calculatePostureScore(
        bestDepthFrame.angles.hip, 
        bestDepthFrame.angles.back
    );
    const balanceScore = calculateAverageBalance();
    const speedScore = calculateSpeedScore(frameAnalysisData);

    // 종합 점수
    const overall = Math.round(
        depthScore * 0.4 +
        postureScore * 0.3 +
        balanceScore * 0.2 +
        speedScore * 0.1
    );

    analyzeResults.scores = {
        depth: depthScore,
        posture: postureScore,
        balance: balanceScore,
        speed: speedScore,
        overall: overall
    };

    log('최종 점수', analyzeResults.scores);

    // 피드백 생성
    generateFeedback(bestDepthFrame.angles, analyzeResults.scores);
}

// 평균 균형 점수 계산
function calculateAverageBalance() {
    if (frameAnalysisData.length === 0) return 60;
    
    const balanceScores = frameAnalysisData.map(frame => 
        calculateBalanceScore(frame.landmarks)
    );
    return Math.round(
        balanceScores.reduce((a, b) => a + b, 0) / balanceScores.length
    );
}

// 개선된 깊이 점수 계산 (더 관대한 기준)
function calculateDepthScore(kneeAngle) {
    log(`깊이 점수 계산 - 무릎 각도: ${kneeAngle.toFixed(1)}도`);
    
    if (kneeAngle <= 90) {
        return 100;
    } else if (kneeAngle <= 100) {
        return 95;
    } else if (kneeAngle <= 110) {
        return 90;
    } else if (kneeAngle <= 120) {
        return 80;
    } else if (kneeAngle <= 130) {
        return 70;
    } else if (kneeAngle <= 140) {
        return 60;
    } else {
        return Math.max(40, 50 - (kneeAngle - 140) * 0.5);
    }
}

// 개선된 자세 점수 계산
function calculatePostureScore(hipAngle, backAngle) {
    let score = 100;
    
    // 엉덩이 각도 (더 넓은 범위 허용)
    if (hipAngle < 60 || hipAngle > 120) {
        score -= 25;
    } else if (hipAngle < 70 || hipAngle > 110) {
        score -= 15;
    } else if (hipAngle < 80 || hipAngle > 100) {
        score -= 5;
    }
    
    // 등 각도 (자연스러운 기울기 허용)
    if (backAngle < 50 || backAngle > 130) {
        score -= 25;
    } else if (backAngle < 60 || backAngle > 120) {
        score -= 15;
    } else if (backAngle < 70 || backAngle > 110) {
        score -= 5;
    }
    
    return Math.max(50, score);
}

// 균형 점수 계산
function calculateBalanceScore(landmarks) {
    // 좌우 무릎 높이 차이
    const leftKnee = landmarks[25];
    const rightKnee = landmarks[26];
    const heightDiff = Math.abs(leftKnee.y - rightKnee.y);
    
    if (heightDiff < 0.02) return 100;
    if (heightDiff < 0.05) return 90;
    if (heightDiff < 0.1) return 80;
    if (heightDiff < 0.15) return 70;
    return 60;
}

// 속도/일관성 점수 계산
function calculateSpeedScore(frameData) {
    if (frameData.length < 2) return 85;
    
    let angleChanges = [];
    for (let i = 1; i < frameData.length; i++) {
        const change = Math.abs(
            frameData[i].angles.knee - frameData[i-1].angles.knee
        );
        angleChanges.push(change);
    }
    
    const avgChange = angleChanges.reduce((a, b) => a + b, 0) / angleChanges.length;
    log('평균 각도 변화', avgChange);
    
    if (avgChange < 5) return 100;
    if (avgChange < 10) return 90;
    if (avgChange < 15) return 80;
    if (avgChange < 20) return 70;
    return 60;
}

// 각도 계산 함수
function calculateAngles(landmarks) {
    try {
        // 무릎 각도 (왼쪽 다리 기준)
        const knee = calculateAngle(
            landmarks[23], // 왼쪽 엉덩이
            landmarks[25], // 왼쪽 무릎
            landmarks[27]  // 왼쪽 발목
        );
        
        // 엉덩이 각도
        const hip = calculateAngle(
            landmarks[11], // 왼쪽 어깨
            landmarks[23], // 왼쪽 엉덩이
            landmarks[25]  // 왼쪽 무릎
        );
        
        // 등 각도 (상체 기울기)
        const back = calculateAngle(
            landmarks[11], // 왼쪽 어깨
            landmarks[23], // 왼쪽 엉덩이
            { x: landmarks[23].x, y: 1, z: landmarks[23].z } // 수직선
        );
        
        return { knee, hip, back };
    } catch (error) {
        console.error('[AI Squat] 각도 계산 오류:', error);
        return { knee: 180, hip: 180, back: 90 };
    }
}

function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let degrees = Math.abs(radians * 180 / Math.PI);
    if (degrees > 180) degrees = 360 - degrees;
    return degrees;
}

// 피드백 생성
function generateFeedback(angles, scores) {
    analyzeResults.feedback = [];
    
    // 스쿼트 횟수 피드백
    if (squatCount > 0) {
        analyzeResults.feedback.push({
            type: 'success',
            title: `총 ${squatCount}회 완료! 🎯`,
            content: '꾸준한 운동으로 건강을 유지하세요.'
        });
    }
    
    // 깊이 피드백
    if (scores.depth >= 90) {
        analyzeResults.feedback.push({
            type: 'success',
            title: '깊이 훌륭해요! 💪',
            content: '스쿼트 깊이가 완벽합니다. 무릎이 적절한 각도로 굽혀졌어요.'
        });
    } else if (scores.depth >= 70) {
        analyzeResults.feedback.push({
            type: 'warning',
            title: '깊이 조금만 더! 📏',
            content: '조금 더 깊게 앉아보세요. 허벅지가 바닥과 평행이 되도록 해보세요.'
        });
    } else {
        analyzeResults.feedback.push({
            type: 'danger',
            title: '깊이 개선 필요 🎯',
            content: '스쿼트 시 더 깊게 앉아야 해요. 천천히 연습하며 유연성을 기르세요.'
        });
    }
    
    // 자세 피드백
    if (scores.posture >= 85) {
        analyzeResults.feedback.push({
            type: 'success',
            title: '자세 완벽해요! ✨',
            content: '상체 자세가 매우 좋습니다. 척추 정렬이 잘 유지되고 있어요.'
        });
    } else if (scores.posture >= 65) {
        analyzeResults.feedback.push({
            type: 'warning',
            title: '자세 교정 필요 📐',
            content: '상체를 좀 더 곧게 세워주세요. 시선은 정면을 향하도록 하세요.'
        });
    }
    
    // 균형 피드백
    if (scores.balance >= 85) {
        analyzeResults.feedback.push({
            type: 'success',
            title: '균형감 최고! ⚖️',
            content: '좌우 균형이 잘 잡혀있어요. 안정적인 동작입니다.'
        });
    } else if (scores.balance < 70) {
        analyzeResults.feedback.push({
            type: 'warning',
            title: '균형 개선 필요 🤸',
            content: '좌우 균형을 더 신경써주세요. 거울을 보며 연습하면 도움이 됩니다.'
        });
    }
    
    // 종합 격려 메시지
    if (scores.overall >= 85) {
        analyzeResults.feedback.push({
            type: 'motivation',
            title: '정말 잘하고 있어요! 🌟',
            content: '이미 훌륭한 스쿼트 실력을 가지고 있네요! 꾸준히 연습하면 더욱 완벽해질 거예요.'
        });
    } else if (scores.overall >= 70) {
        analyzeResults.feedback.push({
            type: 'motivation',
            title: '좋은 시작이에요! 🚀',
            content: '기본기가 탄탄해요. 위의 피드백을 참고하여 조금씩 개선해나가세요!'
        });
    } else {
        analyzeResults.feedback.push({
            type: 'motivation',
            title: '함께 성장해요! 🌱',
            content: '모든 전문가도 처음엔 초보였어요. 꾸준한 연습이 실력을 만듭니다!'
        });
    }
}

// 결과 표시
function showResults() {
    log('결과 표시');
    
    // UI 전환
    document.getElementById('analyzingSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'block';
    updateStep(3);
    
    // 점수 애니메이션
    animateScore();
    
    // 세부 점수 표시
    document.getElementById('depthScore').textContent = analyzeResults.scores.depth + '점';
    document.getElementById('postureScore').textContent = analyzeResults.scores.posture + '점';
    document.getElementById('balanceScore').textContent = analyzeResults.scores.balance + '점';
    document.getElementById('speedScore').textContent = analyzeResults.scores.speed + '점';
    
    // 피드백 표시
    displayFeedback();
}

// 점수 애니메이션
function animateScore() {
    const targetScore = analyzeResults.scores.overall;
    const scoreDisplay = document.getElementById('scoreDisplay');
    const progressCircle = document.querySelector('.score-ring .progress');
    
    let currentScore = 0;
    const duration = 1500;
    const increment = targetScore / (duration / 16);
    
    const animation = setInterval(() => {
        currentScore += increment;
        if (currentScore >= targetScore) {
            currentScore = targetScore;
            clearInterval(animation);
        }
        
        scoreDisplay.textContent = Math.round(currentScore);
        
        // 원형 프로그레스 업데이트
        const offset = 565.48 - (565.48 * currentScore / 100);
        progressCircle.style.strokeDashoffset = offset;
        
        // 점수에 따른 색상 변경
        if (currentScore >= 80) {
            progressCircle.style.stroke = 'var(--success)';
        } else if (currentScore >= 60) {
            progressCircle.style.stroke = 'var(--warning)';
        } else {
            progressCircle.style.stroke = 'var(--danger)';
        }
    }, 16);
}

// 피드백 표시
function displayFeedback() {
    const container = document.getElementById('feedbackContainer');
    container.innerHTML = '';
    
    analyzeResults.feedback.forEach((feedback, index) => {
        const feedbackCard = document.createElement('div');
        feedbackCard.className = `feedback-card ${feedback.type}`;
        feedbackCard.style.animationDelay = `${index * 0.1}s`;
        feedbackCard.style.animation = 'fadeInUp 0.5s ease forwards';
        
        feedbackCard.innerHTML = `
            <div class="feedback-title">
                <span>${feedback.title}</span>
            </div>
            <div class="feedback-content">${feedback.content}</div>
        `;
        
        container.appendChild(feedbackCard);
    });
}

// 단계 업데이트
function updateStep(step) {
    document.querySelectorAll('.step').forEach((el, index) => {
        if (index < step) {
            el.classList.add('completed');
            el.classList.remove('active');
        } else if (index === step - 1) {
            el.classList.add('active');
            el.classList.remove('completed');
        } else {
            el.classList.remove('active', 'completed');
        }
    });
}

// 결과 다운로드 - 최고의 순간 포함
async function downloadResult() {
    log('결과 다운로드 시작');
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080;
    canvas.height = 1920;
    
    // 배경 그라데이션
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 반투명 오버레이
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 제목
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 80px Noto Sans KR';
    ctx.textAlign = 'center';
    ctx.fillText('AI 스쿼트 분석 결과', canvas.width / 2, 150);
    
    // 최고의 순간 이미지 추가
    if (bestMomentCanvas) {
        // 이미지 프레임
        const imgX = 90;
        const imgY = 220;
        const imgWidth = 900;
        const imgHeight = 506; // 16:9 비율
        
        // 흰색 프레임
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(imgX - 10, imgY - 10, imgWidth + 20, imgHeight + 20);
        
        // 이미지 그리기
        ctx.drawImage(bestMomentCanvas, imgX, imgY, imgWidth, imgHeight);
        
        // 캡션
        ctx.fillStyle = '#ffffff';
        ctx.font = '35px Noto Sans KR';
        ctx.textAlign = 'center';
        ctx.fillText('🏆 최고의 순간', canvas.width / 2, imgY + imgHeight + 60);
        ctx.font = '30px Noto Sans KR';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillText(`무릎 각도: ${lowestKneeAngle.toFixed(1)}°`, canvas.width / 2, imgY + imgHeight + 100);
    }
    
    // 스쿼트 횟수
    if (squatCount > 0) {
        ctx.font = '50px Noto Sans KR';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`총 ${squatCount}회 완료!`, canvas.width / 2, 950);
    }
    
    // 점수 원
    const centerX = canvas.width / 2;
    const centerY = 1150;
    const radius = 150;
    
    // 배경 원
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 30;
    ctx.stroke();
    
    // 점수 원
    const scorePercent = analyzeResults.scores.overall / 100;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + (2 * Math.PI * scorePercent));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 30;
    ctx.lineCap = 'round';
    ctx.stroke();
    
    // 점수 텍스트
    ctx.font = 'bold 120px Noto Sans KR';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(analyzeResults.scores.overall, centerX, centerY);
    
    ctx.font = '40px Noto Sans KR';
    ctx.fillText('점', centerX, centerY + 80);
    
    // 세부 점수
    const scoreY = 1450;
    ctx.font = '35px Noto Sans KR';
    const scores = [
        { label: '깊이', value: analyzeResults.scores.depth },
        { label: '자세', value: analyzeResults.scores.posture },
        { label: '균형', value: analyzeResults.scores.balance },
        { label: '속도', value: analyzeResults.scores.speed }
    ];
    
    scores.forEach((score, index) => {
        const x = 200 + (index % 2) * 440;
        const y = scoreY + Math.floor(index / 2) * 80;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.textAlign = 'left';
        ctx.fillText(score.label, x, y);
        
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.fillText(score.value + '점', x + 200, y);
    });
    
    // 날짜
    ctx.font = '30px Noto Sans KR';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.textAlign = 'center';
    ctx.fillText(new Date().toLocaleDateString('ko-KR'), centerX, 1700);
    
    // 하단 로고
    ctx.font = 'bold 45px Noto Sans KR';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('AI 스쿼트 코치', centerX, 1780);
    
    // 프라이버시 문구
    ctx.font = '25px Noto Sans KR';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('🔒 영상은 저장되지 않습니다', centerX, 1850);
    
    // 모바일 다운로드 처리
    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `squat_result_${new Date().getTime()}.png`;
        
        // 모바일에서 다운로드 트리거
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // 일정 시간 후 URL 정리
        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 100);
    }, 'image/png');
}

// 분석 초기화
function resetAnalysis() {
    log('분석 초기화');
    
    // 상태 초기화
    analyzeResults = {
        scores: {
            depth: 0,
            posture: 0,
            balance: 0,
            speed: 0,
            overall: 0
        },
        feedback: []
    };
    frameAnalysisData = [];
    isAnalyzing = false;
    squatCount = 0;
    squatPhase = 'standing';
    bestMomentTime = 0;
    lowestKneeAngle = 180;
    bestMomentCanvas = null;
    
    // UI 초기화
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('analyzingSection').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'block';
    document.getElementById('videoPreview').style.display = 'none';
    document.getElementById('videoInput').value = '';
    document.getElementById('analyzeBtn').disabled = true;
    updateStep(1);
    
    // 진행률 초기화
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('frameInfo').textContent = '';
    document.getElementById('analysisStatus').textContent = '잠시만 기다려주세요';
    
    // 비디오 정리
    if (uploadedVideo) {
        const currentSrc = uploadedVideo.src;
        uploadedVideo.src = '';
        if (currentSrc && currentSrc.startsWith('blob:')) {
            URL.revokeObjectURL(currentSrc);
        }
    }
    
    // 디버그 패널 초기화
    const debugPanel = document.getElementById('debugPanel');
    if (debugPanel) {
        debugPanel.innerHTML = '';
        debugPanel.classList.remove('show');
    }
}

// 페이지 로드 시 초기화
window.addEventListener('DOMContentLoaded', async () => {
    log('=== 페이지 로드 완료 ===');
    
    // UI 이벤트 초기화
    initializeUpload();
    
    // 버튼 이벤트 - 터치 이벤트 추가
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) {
        // 클릭 이벤트
        analyzeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            startAnalysis();
        });
        
        // 터치 이벤트
        analyzeBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            startAnalysis();
        });
    }
    
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            downloadResult();
        });
        
        downloadBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            downloadResult();
        });
    }
    
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            resetAnalysis();
        });
        
        resetBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            resetAnalysis();
        });
    }
    
    // MediaPipe 로드 대기
    let attempts = 0;
    const maxAttempts = 30;
    
    const checkMediaPipe = setInterval(async () => {
        attempts++;
        
        if (typeof Pose !== 'undefined') {
            clearInterval(checkMediaPipe);
            log('MediaPipe Pose 라이브러리 로드 확인');
            
            try {
                await initializePose();
                log('Pose 초기화 성공');
            } catch (error) {
                console.error('[AI Squat] 초기 Pose 초기화 실패:', error);
            }
        } else if (attempts >= maxAttempts) {
            clearInterval(checkMediaPipe);
            console.error('[AI Squat] MediaPipe 로드 타임아웃');
            alert('필요한 라이브러리를 로드할 수 없습니다.\n페이지를 새로고침하거나 인터넷 연결을 확인해주세요.');
        } else if (attempts % 10 === 0) {
            log(`MediaPipe 로딩 대기 중... (${attempts}/${maxAttempts})`);
        }
    }, 500);
});

// 전역 디버그 함수
window.aiSquatDebug = function() {
    console.group('[AI Squat] 디버그 정보');
    console.log('Pose 초기화 상태:', poseInitialized);
    console.log('Pose 객체:', !!pose);
    console.log('현재 분석 중:', isAnalyzing);
    console.log('수집된 프레임 수:', frameAnalysisData.length);
    console.log('스쿼트 횟수:', squatCount);
    console.log('현재 단계:', squatPhase);
    console.log('최고의 순간:', {
        시간: bestMomentTime,
        각도: lowestKneeAngle,
        캡처여부: !!bestMomentCanvas
    });
    console.log('분석 결과:', analyzeResults);
    console.log('MediaPipe 로드 상태:', typeof Pose !== 'undefined');
    if (uploadedVideo) {
        console.log('비디오 정보:', {
            src: uploadedVideo.src ? 'loaded' : 'empty',
            duration: uploadedVideo.duration,
            readyState: uploadedVideo.readyState,
            videoWidth: uploadedVideo.videoWidth,
            videoHeight: uploadedVideo.videoHeight,
            currentTime: uploadedVideo.currentTime
        });
    }
    console.groupEnd();
};

// 에러 핸들링
window.addEventListener('error', (event) => {
    if (event.message.includes('pose') || event.message.includes('mediapipe')) {
        console.error('[AI Squat] MediaPipe 관련 에러:', event.message);
        log(`에러 발생: ${event.message}`);
    }
});

window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.toString().includes('mediapipe')) {
        console.error('[AI Squat] MediaPipe Promise 에러:', event.reason);
    }
});

console.log('[AI Squat] 스크립트 로드 완료. 디버그: window.aiSquatDebug()');
    document.getElementById('postureScore').textContent = analyzeResults.scores// 전역 변수
let pose = null;
let uploadedVideo = null;
let analyzeResults = {
    scores: {
        depth: 0,
        posture: 0,
        balance: 0,
        speed: 0,
        overall: 0
    },
    feedback: []
};
let frameAnalysisData = [];
let isAnalyzing = false;
let poseInitialized = false;
let squatCount = 0;
let squatPhase = 'standing'; // standing, descending, bottom, ascending

// 디버그 모드
const DEBUG_MODE = true;
const log = (message, data = null) => {
    if (DEBUG_MODE) {
        const timestamp = new Date().toTimeString().split(' ')[0];
        console.log(`[${timestamp}] [AI Squat] ${message}`, data || '');
        updateDebugPanel(`${timestamp} - ${message}`);
    }
};

// 디버그 패널 업데이트
function updateDebugPanel(message) {
    const panel = document.getElementById('debugPanel');
    if (DEBUG_MODE && panel) {
        panel.classList.add('show');
        panel.innerHTML = message + '<br>' + panel.innerHTML;
        const lines = panel.innerHTML.split('<br>');
        if (lines.length > 10) {
            panel.innerHTML = lines.slice(0, 10).join('<br>');
        }
    }
}

// MediaPipe Pose 초기화
async function initializePose() {
    if (poseInitialized) {
        log('Pose 이미 초기화됨');
        return true;
    }

    log('Pose 초기화 시작');
    
    try {
        // Pose 인스턴스 생성
        pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
            }
        });

        // 옵션 설정
        pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        // 결과 콜백 설정
        pose.onResults(onPoseResults);
        
        poseInitialized = true;
        log('Pose 초기화 완료');
        return true;
        
    } catch (error) {
        console.error('[AI Squat] Pose 초기화 실패:', error);
        poseInitialized = false;
        return false;
    }
}

// 파일 업로드 이벤트 초기화
function initializeUpload() {
    const videoInput = document.getElementById('videoInput');
    const uploadArea = document.getElementById('uploadArea');
    
    if (uploadArea) {
        uploadArea.addEventListener('click', () => {
            videoInput.click();
        });
        
        // 드래그 앤 드롭
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('video/')) {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(files[0]);
                videoInput.files = dataTransfer.files;
                handleFileUpload({ target: { files: files } });
            }
        });
    }
    
    if (videoInput) {
        videoInput.addEventListener('change', handleFileUpload);
    }
}

// 파일 업로드 처리
function handleFileUpload(event) {
    const file = event.target.files[0];
    log('파일 업로드 시도', { 
        fileName: file?.name, 
        fileSize: file ? `${(file.size / 1024 / 1024).toFixed(2)}MB` : 'N/A', 
        fileType: file?.type 
    });
    
    if (!file || !file.type.startsWith('video/')) {
        console.error('[AI Squat] 잘못된 파일 형식:', file?.type);
        alert('비디오 파일을 선택해주세요.');
        return;
    }

    const videoPreview = document.getElementById('videoPreview');
    const video = document.getElementById('uploadedVideo');
    
    if (!video) {
        console.error('[AI Squat] 비디오 엘리먼트를 찾을 수 없습니다');
        return;
    }
    
    // 기존 비디오 URL 정리
    if (video.src && video.src.startsWith('blob:')) {
        URL.revokeObjectURL(video.src);
    }
    
    const videoURL = URL.createObjectURL(file);
    video.src = videoURL;
    
    if (videoPreview) {
        videoPreview.style.display = 'block';
    }
    
    video.onloadedmetadata = () => {
        log('비디오 메타데이터 로드 완료', {
            duration: `${video.duration.toFixed(1)}초`,
            resolution: `${video.videoWidth}x${video.videoHeight}`,
            readyState: video.readyState
        });
        
        const analyzeBtn = document.getElementById('analyzeBtn');
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
        }
        updateStep(1);
    };
    
    video.onerror = (e) => {
        console.error('[AI Squat] 비디오 로드 실패:', e);
        alert('비디오 파일을 읽을 수 없습니다. 다른 파일을 선택해주세요.');
    };
}

// 분석 시작
async function startAnalysis() {
    if (isAnalyzing) {
        log('이미 분석 중입니다');
        return;
    }
    
    uploadedVideo = document.getElementById('uploadedVideo');
    if (!uploadedVideo || !uploadedVideo.src) {
        alert('비디오를 먼저 업로드해주세요.');
        return;
    }
    
    isAnalyzing = true;
    log('=== 분석 시작 ===');
    
    try {
        // UI 전환
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('analyzingSection').style.display = 'block';
        updateStep(2);

        // 캔버스 설정
        const canvas = document.getElementById('outputCanvas');
        const canvasCtx = canvas.getContext('2d');
        
        // 비디오 준비 확인
        if (uploadedVideo.readyState < 2) {
            log('비디오 로딩 대기 중...');
            await new Promise((resolve) => {
                uploadedVideo.addEventListener('loadeddata', resolve, { once: true });
            });
        }
        
        canvas.width = uploadedVideo.videoWidth;
        canvas.height = uploadedVideo.videoHeight;
        log('캔버스 설정 완료', { 
            width: canvas.width, 
            height: canvas.height
        });

        // Pose 초기화 확인
        if (!poseInitialized || !pose) {
            log('Pose 재초기화 필요');
            const initialized = await initializePose();
            if (!initialized) {
                throw new Error('Pose 초기화 실패');
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 분석 데이터 초기화
        frameAnalysisData = [];
        squatCount = 0;
        squatPhase = 'standing';
        const fps = 2; // 초당 2프레임
        const totalFrames = Math.floor(uploadedVideo.duration * fps);
        let processedFrames = 0;

        log('분석 파라미터', {
            총시간: `${uploadedVideo.duration.toFixed(1)}초`,
            FPS: fps,
            총프레임: totalFrames
        });

        // 상태 업데이트
        const analysisStatus = document.getElementById('analysisStatus');
        const frameInfo = document.getElementById('frameInfo');
        const progressFill = document.getElementById('progressFill');
        
        if (analysisStatus) {
            analysisStatus.textContent = '포즈 인식을 시작합니다...';
        }

        // 비디오 분석 루프
        for (let i = 0; i < totalFrames; i++) {
            const currentTime = i / fps;
            
            if (currentTime >= uploadedVideo.duration) {
                break;
            }
            
            try {
                // 비디오 시간 설정
                await new Promise((resolve) => {
                    uploadedVideo.currentTime = currentTime;
                    
                    const seekHandler = () => {
                        uploadedVideo.removeEventListener('seeked', seekHandler);
                        resolve();
                    };
                    
                    uploadedVideo.addEventListener('seeked', seekHandler);
                    
                    setTimeout(() => {
                        uploadedVideo.removeEventListener('seeked', seekHandler);
                        resolve();
                    }, 1000);
                });
                
                // 캔버스에 그리기
                canvasCtx.drawImage(uploadedVideo, 0, 0, canvas.width, canvas.height);
                
                // Pose 분석
                if (pose && pose.send) {
                    await pose.send({ image: canvas });
                }
                
                processedFrames++;
                
                // UI 업데이트
                const progress = (processedFrames / totalFrames) * 100;
                if (progressFill) {
                    progressFill.style.width = `${progress}%`;
                }
                if (frameInfo) {
                    frameInfo.textContent = `프레임 ${processedFrames}/${totalFrames} 분석 중...`;
                }
                if (analysisStatus && squatCount > 0) {
                    analysisStatus.textContent = `스쿼트 ${squatCount}회 감지됨`;
                }
                
                // CPU 과부하 방지
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                log(`프레임 ${i} 처리 오류: ${error.message}`);
                continue;
            }
        }

        // 분석 완료 대기
        await new Promise(resolve => setTimeout(resolve, 500));

        log('=== 분석 완료 ===', {
            처리프레임: processedFrames,
            감지프레임: frameAnalysisData.length,
            스쿼트횟수: squatCount,
            감지율: frameAnalysisData.length > 0 ? 
                `${((frameAnalysisData.length / processedFrames) * 100).toFixed(1)}%` : '0%'
        });

        // 결과 계산
        if (frameAnalysisData.length > 0) {
            calculateFinalScores();
        } else {
            // 감지 실패 시 기본 점수
            analyzeResults.scores = {
                depth: 60,
                posture: 60,
                balance: 60,
                speed: 60,
                overall: 60
            };
            generateFeedback({ knee: 120, hip: 90, back: 85 }, analyzeResults.scores);
        }

        // 결과 표시
        setTimeout(() => {
            isAnalyzing = false;
            showResults();
        }, 1000);
        
    } catch (error) {
        console.error('[AI Squat] 분석 오류:', error);
        alert(`분석 중 오류가 발생했습니다:\n${error.message}`);
        isAnalyzing = false;
        resetAnalysis();
    }
}

// Pose 결과 처리
function onPoseResults(results) {
    try {
        if (!results || !results.poseLandmarks) {
            return;
        }

        const landmarks = results.poseLandmarks;
        
        // 필요한 랜드마크 확인 (MediaPipe Pose 랜드마크 인덱스)
        // 11: 왼쪽 어깨, 12: 오른쪽 어깨
        // 23: 왼쪽 엉덩이, 24: 오른쪽 엉덩이
        // 25: 왼쪽 무릎, 26: 오른쪽 무릎
        // 27: 왼쪽 발목, 28: 오른쪽 발목
        if (!landmarks[11] || !landmarks[23] || !landmarks[25] || !landmarks[27]) {
            log('필요한 랜드마크 누락');
            return;
        }
        
        // 가시성 체크
        const minVisibility = 0.3;
        if (landmarks[25].visibility < minVisibility || 
            landmarks[27].visibility < minVisibility) {
            return;
        }
        
        // 각도 계산
        const angles = calculateAngles(landmarks);
        
        // 유효성 검증
        if (angles.knee < 30 || angles.knee > 180 || isNaN(angles.knee)) {
            return;
        }
        
        // 스쿼트 단계 감지
        detectSquatPhase(angles.knee);
        
        log('포즈 감지 성공', {
            무릎각도: angles.knee.toFixed(1),
            스쿼트단계: squatPhase,
            프레임: frameAnalysisData.length + 1
        });
        
        // 데이터 저장
        frameAnalysisData.push({
            timestamp: uploadedVideo?.currentTime || 0,
            angles: angles,
            landmarks: landmarks,
            phase: squatPhase
        });
        
    } catch (error) {
        console.error('[AI Squat] Pose 결과 처리 오류:', error);
    }
}

// 스쿼트 단계 감지 (완화된 기준)
function detectSquatPhase(kneeAngle) {
    const STANDING_THRESHOLD = 150;  // 서있는 상태
    const DESCENDING_THRESHOLD = 140; // 내려가기 시작
    const BOTTOM_THRESHOLD = 110;     // 바닥 (완화된 기준)
    const ASCENDING_THRESHOLD = 120;  // 올라가기 시작
    
    switch (squatPhase) {
        case 'standing':
            if (kneeAngle < DESCENDING_THRESHOLD) {
                squatPhase = 'descending';
            }
            break;
            
        case 'descending':
            if (kneeAngle < BOTTOM_THRESHOLD) {
                squatPhase = 'bottom';
            } else if (kneeAngle > STANDING_THRESHOLD) {
                squatPhase = 'standing';
            }
            break;
            
        case 'bottom':
            if (kneeAngle > ASCENDING_THRESHOLD) {
                squatPhase = 'ascending';
            }
            break;
            
        case 'ascending':
            if (kneeAngle > STANDING_THRESHOLD) {
                squatPhase = 'standing';
                squatCount++; // 한 사이클 완료
                log('스쿼트 완료!', { 총횟수: squatCount });
            }
            break;
    }
}

// 최종 점수 계산
function calculateFinalScores() {
    log('최종 점수 계산 시작', { 
        총프레임수: frameAnalysisData.length,
        스쿼트횟수: squatCount
    });

    if (frameAnalysisData.length === 0) {
        analyzeResults.scores = {
            depth: 60,
            posture: 60,
            balance: 60,
            speed: 60,
            overall: 60
        };
        return;
    }

    // 가장 깊은 스쿼트 찾기
    let bestDepthFrame = frameAnalysisData[0];
    let minKneeAngle = 180;
    
    frameAnalysisData.forEach(frame => {
        if (frame.angles.knee < minKneeAngle) {
            minKneeAngle = frame.angles.knee;
            bestDepthFrame = frame;
        }
    });

    log('최고 깊이 프레임', {
        무릎각도: minKneeAngle.toFixed(1),
        시간: bestDepthFrame.timestamp.toFixed(2)
    });

    // 점수 계산
    const depthScore = calculateDepthScore(minKneeAngle);
    const postureScore = calculatePostureScore(
        bestDepthFrame.angles.hip, 
        bestDepthFrame.angles.back
    );
    const balanceScore = calculateAverageBalance();
    const speedScore = calculateSpeedScore(frameAnalysisData);

    // 종합 점수
    const overall = Math.round(
        depthScore * 0.4 +
        postureScore * 0.3 +
        balanceScore * 0.2 +
        speedScore * 0.1
    );

    analyzeResults.scores = {
        depth: depthScore,
        posture: postureScore,
        balance: balanceScore,
        speed: speedScore,
        overall: overall
    };

    log('최종 점수', analyzeResults.scores);

    // 피드백 생성
    generateFeedback(bestDepthFrame.angles, analyzeResults.scores);
}

// 평균 균형 점수 계산
function calculateAverageBalance() {
    if (frameAnalysisData.length === 0) return 60;
    
    const balanceScores = frameAnalysisData.map(frame => 
        calculateBalanceScore(frame.landmarks)
    );
    return Math.round(
        balanceScores.reduce((a, b) => a + b, 0) / balanceScores.length
    );
}

// 개선된 깊이 점수 계산 (더 관대한 기준)
function calculateDepthScore(kneeAngle) {
    log(`깊이 점수 계산 - 무릎 각도: ${kneeAngle.toFixed(1)}도`);
    
    if (kneeAngle <= 90) {
        return 100;
    } else if (kneeAngle <= 100) {
        return 95;
    } else if (kneeAngle <= 110) {
        return 90;
    } else if (kneeAngle <= 120) {
        return 80;
    } else if (kneeAngle <= 130) {
        return 70;
    } else if (kneeAngle <= 140) {
        return 60;
    } else {
        return Math.max(40, 50 - (kneeAngle - 140) * 0.5);
    }
}

// 개선된 자세 점수 계산
function calculatePostureScore(hipAngle, backAngle) {
    let score = 100;
    
    // 엉덩이 각도 (더 넓은 범위 허용)
    if (hipAngle < 60 || hipAngle > 120) {
        score -= 25;
    } else if (hipAngle < 70 || hipAngle > 110) {
        score -= 15;
    } else if (hipAngle < 80 || hipAngle > 100) {
        score -= 5;
    }
    
    // 등 각도 (자연스러운 기울기 허용)
    if (backAngle < 50 || backAngle > 130) {
        score -= 25;
    } else if (backAngle < 60 || backAngle > 120) {
        score -= 15;
    } else if (backAngle < 70 || backAngle > 110) {
        score -= 5;
    }
    
    return Math.max(50, score);
}

// 균형 점수 계산
function calculateBalanceScore(landmarks) {
    // 좌우 무릎 높이 차이
    const leftKnee = landmarks[25];
    const rightKnee = landmarks[26];
    const heightDiff = Math.abs(leftKnee.y - rightKnee.y);
    
    if (heightDiff < 0.02) return 100;
    if (heightDiff < 0.05) return 90;
    if (heightDiff < 0.1) return 80;
    if (heightDiff < 0.15) return 70;
    return 60;
}

// 속도/일관성 점수 계산
function calculateSpeedScore(frameData) {
    if (frameData.length < 2) return 85;
    
    let angleChanges = [];
    for (let i = 1; i < frameData.length; i++) {
        const change = Math.abs(
            frameData[i].angles.knee - frameData[i-1].angles.knee
        );
        angleChanges.push(change);
    }
    
    const avgChange = angleChanges.reduce((a, b) => a + b, 0) / angleChanges.length;
    log('평균 각도 변화', avgChange);
    
    if (avgChange < 5) return 100;
    if (avgChange < 10) return 90;
    if (avgChange < 15) return 80;
    if (avgChange < 20) return 70;
    return 60;
}

// 각도 계산 함수
function calculateAngles(landmarks) {
    try {
        // 무릎 각도 (왼쪽 다리 기준)
        const knee = calculateAngle(
            landmarks[23], // 왼쪽 엉덩이
            landmarks[25], // 왼쪽 무릎
            landmarks[27]  // 왼쪽 발목
        );
        
        // 엉덩이 각도
        const hip = calculateAngle(
            landmarks[11], // 왼쪽 어깨
            landmarks[23], // 왼쪽 엉덩이
            landmarks[25]  // 왼쪽 무릎
        );
        
        // 등 각도 (상체 기울기)
        const back = calculateAngle(
            landmarks[11], // 왼쪽 어깨
            landmarks[23], // 왼쪽 엉덩이
            { x: landmarks[23].x, y: 1, z: landmarks[23].z } // 수직선
        );
        
        return { knee, hip, back };
    } catch (error) {
        console.error('[AI Squat] 각도 계산 오류:', error);
        return { knee: 180, hip: 180, back: 90 };
    }
}

function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let degrees = Math.abs(radians * 180 / Math.PI);
    if (degrees > 180) degrees = 360 - degrees;
    return degrees;
}

// 피드백 생성
function generateFeedback(angles, scores) {
    analyzeResults.feedback = [];
    
    // 스쿼트 횟수 피드백
    if (squatCount > 0) {
        analyzeResults.feedback.push({
            type: 'success',
            title: `총 ${squatCount}회 완료! 🎯`,
            content: '꾸준한 운동으로 건강을 유지하세요.'
        });
    }
    
    // 깊이 피드백
    if (scores.depth >= 90) {
        analyzeResults.feedback.push({
            type: 'success',
            title: '깊이 훌륭해요! 💪',
            content: '스쿼트 깊이가 완벽합니다. 무릎이 적절한 각도로 굽혀졌어요.'
        });
    } else if (scores.depth >= 70) {
        analyzeResults.feedback.push({
            type: 'warning',
            title: '깊이 조금만 더! 📏',
            content: '조금 더 깊게 앉아보세요. 허벅지가 바닥과 평행이 되도록 해보세요.'
        });
    } else {
        analyzeResults.feedback.push({
            type: 'danger',
            title: '깊이 개선 필요 🎯',
            content: '스쿼트 시 더 깊게 앉아야 해요. 천천히 연습하며 유연성을 기르세요.'
        });
    }
    
    // 자세 피드백
    if (scores.posture >= 85) {
        analyzeResults.feedback.push({
            type: 'success',
            title: '자세 완벽해요! ✨',
            content: '상체 자세가 매우 좋습니다. 척추 정렬이 잘 유지되고 있어요.'
        });
    } else if (scores.posture >= 65) {
        analyzeResults.feedback.push({
            type: 'warning',
            title: '자세 교정 필요 📐',
            content: '상체를 좀 더 곧게 세워주세요. 시선은 정면을 향하도록 하세요.'
        });
    }
    
    // 균형 피드백
    if (scores.balance >= 85) {
        analyzeResults.feedback.push({
            type: 'success',
            title: '균형감 최고! ⚖️',
            content: '좌우 균형이 잘 잡혀있어요. 안정적인 동작입니다.'
        });
    } else if (scores.balance < 70) {
        analyzeResults.feedback.push({
            type: 'warning',
            title: '균형 개선 필요 🤸',
            content: '좌우 균형을 더 신경써주세요. 거울을 보며 연습하면 도움이 됩니다.'
        });
    }
    
    // 종합 격려 메시지
    if (scores.overall >= 85) {
        analyzeResults.feedback.push({
            type: 'motivation',
            title: '정말 잘하고 있어요! 🌟',
            content: '이미 훌륭한 스쿼트 실력을 가지고 있네요! 꾸준히 연습하면 더욱 완벽해질 거예요.'
        });
    } else if (scores.overall >= 70) {
        analyzeResults.feedback.push({
            type: 'motivation',
            title: '좋은 시작이에요! 🚀',
            content: '기본기가 탄탄해요. 위의 피드백을 참고하여 조금씩 개선해나가세요!'
        });
    } else {
        analyzeResults.feedback.push({
            type: 'motivation',
            title: '함께 성장해요! 🌱',
            content: '모든 전문가도 처음엔 초보였어요. 꾸준한 연습이 실력을 만듭니다!'
        });
    }
}

// 결과 표시
function showResults() {
    log('결과 표시');
    
    // UI 전환
    document.getElementById('analyzingSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'block';
    updateStep(3);
    
    // 점수 애니메이션
    animateScore();
    
    // 세부 점수 표시
    document.getElementById('depthScore').textContent = analyzeResults.scores.depth + '점';
    document.getElementById('postureScore').textContent = analyzeResults.scores.posture + '점';
    document.getElementById('balanceScore').textContent = analyzeResults.scores.balance + '점';
    document.getElementById('speedScore').textContent = analyzeResults.scores.speed + '점';
    
    // 피드백 표시
    displayFeedback();
}

// 점수 애니메이션
function animateScore() {
    const targetScore = analyzeResults.scores.overall;
    const scoreDisplay = document.getElementById('scoreDisplay');
    const progressCircle = document.querySelector('.score-ring .progress');
    
    let currentScore = 0;
    const duration = 1500;
    const increment = targetScore / (duration / 16);
    
    const animation = setInterval(() => {
        currentScore += increment;
        if (currentScore >= targetScore) {
            currentScore = targetScore;
            clearInterval(animation);
        }
        
        scoreDisplay.textContent = Math.round(currentScore);
        
        // 원형 프로그레스 업데이트
        const offset = 565.48 - (565.48 * currentScore / 100);
        progressCircle.style.strokeDashoffset = offset;
        
        // 점수에 따른 색상 변경
        if (currentScore >= 80) {
            progressCircle.style.stroke = 'var(--success)';
        } else if (currentScore >= 60) {
            progressCircle.style.stroke = 'var(--warning)';
        } else {
            progressCircle.style.stroke = 'var(--danger)';
        }
    }, 16);
}

// 피드백 표시
function displayFeedback() {
    const container = document.getElementById('feedbackContainer');
    container.innerHTML = '';
    
    analyzeResults.feedback.forEach((feedback, index) => {
        const feedbackCard = document.createElement('div');
        feedbackCard.className = `feedback-card ${feedback.type}`;
        feedbackCard.style.animationDelay = `${index * 0.1}s`;
        feedbackCard.style.animation = 'fadeInUp 0.5s ease forwards';
        
        feedbackCard.innerHTML = `
            <div class="feedback-title">
                <span>${feedback.title}</span>
            </div>
            <div class="feedback-content">${feedback.content}</div>
        `;
        
        container.appendChild(feedbackCard);
    });
}

// 단계 업데이트
function updateStep(step) {
    document.querySelectorAll('.step').forEach((el, index) => {
        if (index < step) {
            el.classList.add('completed');
            el.classList.remove('active');
        } else if (index === step - 1) {
            el.classList.add('active');
            el.classList.remove('completed');
        } else {
            el.classList.remove('active', 'completed');
        }
    });
}

// 결과 다운로드
function downloadResult() {
    log('결과 다운로드 시작');
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1080;
    canvas.height = 1920;
    
    // 배경 그라데이션
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 반투명 오버레이
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 제목
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 80px Noto Sans KR';
    ctx.textAlign = 'center';
    ctx.fillText('AI 스쿼트 분석 결과', canvas.width / 2, 200);
    
    // 스쿼트 횟수
    if (squatCount > 0) {
        ctx.font = '50px Noto Sans KR';
        ctx.fillText(`총 ${squatCount}회 완료!`, canvas.width / 2, 300);
    }
    
    // 점수 원
    const centerX = canvas.width / 2;
    const centerY = 600;
    const radius = 200;
    
    // 배경 원
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 40;
    ctx.stroke();
    
    // 점수 원
    const scorePercent = analyzeResults.scores.overall / 100;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + (2 * Math.PI * scorePercent));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 40;
    ctx.lineCap = 'round';
    ctx.stroke();
    
    // 점수 텍스트
    ctx.font = 'bold 150px Noto Sans KR';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(analyzeResults.scores.overall, centerX, centerY);
    
    ctx.font = '50px Noto Sans KR';
    ctx.fillText('점', centerX, centerY + 100);
    
    // 세부 점수
    const scoreY = 1000;
    const scoreSpacing = 150;
    
    ctx.font = '45px Noto Sans KR';
    const scores = [
        { label: '깊이', value: analyzeResults.scores.depth },
        { label: '자세', value: analyzeResults.scores.posture },
        { label: '균형', value: analyzeResults.scores.balance },
        { label: '속도', value: analyzeResults.scores.speed }
    ];
    
    scores.forEach((score, index) => {
        const x = 200 + (index % 2) * 440;
        const y = scoreY + Math.floor(index / 2) * 120;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.textAlign = 'left';
        ctx.fillText(score.label, x, y);
        
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.fillText(score.value + '점', x + 200, y);
    });
    
    // 날짜
    ctx.font = '35px Noto Sans KR';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.textAlign = 'center';
    ctx.fillText(new Date().toLocaleDateString('ko-KR'), centerX, 1400);
    
    // 하단 로고
    ctx.font = 'bold 60px Noto Sans KR';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('AI 스쿼트 코치', centerX, 1700);
    
    // 프라이버시 문구
    ctx.font = '30px Noto Sans KR';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('🔒 영상은 저장되지 않습니다', centerX, 1800);
    
    // 다운로드
    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `squat_result_${new Date().getTime()}.png`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

// 분석 초기화
function resetAnalysis() {
    log('분석 초기화');
    
    // 상태 초기화
    analyzeResults = {
        scores: {
            depth: 0,
            posture: 0,
            balance: 0,
            speed: 0,
            overall: 0
        },
        feedback: []
    };
    frameAnalysisData = [];
    isAnalyzing = false;
    squatCount = 0;
    squatPhase = 'standing';
    
    // UI 초기화
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('analyzingSection').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'block';
    document.getElementById('videoPreview').style.display = 'none';
    document.getElementById('videoInput').value = '';
    document.getElementById('analyzeBtn').disabled = true;
    updateStep(1);
    
    // 진행률 초기화
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('frameInfo').textContent = '';
    document.getElementById('analysisStatus').textContent = '잠시만 기다려주세요';
    
    // 비디오 정리
    if (uploadedVideo) {
        const currentSrc = uploadedVideo.src;
        uploadedVideo.src = '';
        if (currentSrc && currentSrc.startsWith('blob:')) {
            URL.revokeObjectURL(currentSrc);
        }
    }
    
    // 디버그 패널 초기화
    const debugPanel = document.getElementById('debugPanel');
    if (debugPanel) {
        debugPanel.innerHTML = '';
        debugPanel.classList.remove('show');
    }
}

// 페이지 로드 시 초기화
window.addEventListener('DOMContentLoaded', async () => {
    log('=== 페이지 로드 완료 ===');
    
    // UI 이벤트 초기화
    initializeUpload();
    
    // 버튼 이벤트
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', startAnalysis);
    }
    
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadResult);
    }
    
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetAnalysis);
    }
    
    // MediaPipe 로드 대기
    let attempts = 0;
    const maxAttempts = 30;
    
    const checkMediaPipe = setInterval(async () => {
        attempts++;
        
        if (typeof Pose !== 'undefined') {
            clearInterval(checkMediaPipe);
            log('MediaPipe Pose 라이브러리 로드 확인');
            
            try {
                await initializePose();
                log('Pose 초기화 성공');
            } catch (error) {
                console.error('[AI Squat] 초기 Pose 초기화 실패:', error);
            }
        } else if (attempts >= maxAttempts) {
            clearInterval(checkMediaPipe);
            console.error('[AI Squat] MediaPipe 로드 타임아웃');
            alert('필요한 라이브러리를 로드할 수 없습니다.\n페이지를 새로고침하거나 인터넷 연결을 확인해주세요.');
        } else if (attempts % 10 === 0) {
            log(`MediaPipe 로딩 대기 중... (${attempts}/${maxAttempts})`);
        }
    }, 500);
});

// 전역 디버그 함수
window.aiSquatDebug = function() {
    console.group('[AI Squat] 디버그 정보');
    console.log('Pose 초기화 상태:', poseInitialized);
    console.log('Pose 객체:', !!pose);
    console.log('현재 분석 중:', isAnalyzing);
    console.log('수집된 프레임 수:', frameAnalysisData.length);
    console.log('스쿼트 횟수:', squatCount);
    console.log('현재 단계:', squatPhase);
    console.log('분석 결과:', analyzeResults);
    console.log('MediaPipe 로드 상태:', typeof Pose !== 'undefined');
    if (uploadedVideo) {
        console.log('비디오 정보:', {
            src: uploadedVideo.src ? 'loaded' : 'empty',
            duration: uploadedVideo.duration,
            readyState: uploadedVideo.readyState,
            videoWidth: uploadedVideo.videoWidth,
            videoHeight: uploadedVideo.videoHeight,
            currentTime: uploadedVideo.currentTime
        });
    }
    console.groupEnd();
};

// 에러 핸들링
window.addEventListener('error', (event) => {
    if (event.message.includes('pose') || event.message.includes('mediapipe')) {
        console.error('[AI Squat] MediaPipe 관련 에러:', event.message);
        log(`에러 발생: ${event.message}`);
    }
});

window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.toString().includes('mediapipe')) {
        console.error('[AI Squat] MediaPipe Promise 에러:', event.reason);
    }
});

// 모바일 최적화
let touchStartY = 0;
document.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
});

document.addEventListener('touchmove', (e) => {
    const touchY = e.touches[0].clientY;
    const diff = touchStartY - touchY;
    
    if (diff > 0 && window.scrollY === 0) {
        e.preventDefault();
    }
}, { passive: false });

console.log('[AI Squat] 스크립트 로드 완료. 디버그: window.aiSquatDebug()');
