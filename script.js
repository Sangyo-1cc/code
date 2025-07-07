<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="description" content="AI 기반 스쿼트 자세 분석기 - 완벽한 스쿼트를 위한 개인 트레이너">
    <title>AI 스쿼트 코치</title>
    
    <!-- Favicon 설정 -->
    <link rel="icon" type="image/png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==">
    
    <!-- Google Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;700&display=swap" rel="stylesheet">
    
    <!-- 스타일시트 -->
    <link rel="stylesheet" href="styles.css">
    
    <!-- MediaPipe 포즈 감지 -->
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1640029074/camera_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/control_utils@0.6.1629159505/control_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1620248257/drawing_utils.js" crossorigin="anonymous"></script>
</head>
<body>
    <div class="app-container">
        <!-- 헤더 -->
        <header class="header">
            <h1>AI 스쿼트 코치</h1>
            <p>완벽한 스쿼트 자세를 위한 당신의 개인 트레이너</p>
        </header>

        <!-- 프라이버시 배너 추가 -->
        <div class="privacy-banner">
            <span class="icon">🔒</span>
            <span>코치는 당신의 영상을 저장하지 않습니다.</span>
        </div>

        <!-- 단계 표시기 -->
        <div class="step-indicator">
            <div class="step active" data-step="1">1</div>
            <div class="step" data-step="2">2</div>
            <div class="step" data-step="3">3</div>
        </div>

        <!-- 메인 컨텐츠 -->
        <main class="main-content">
            <!-- 업로드 섹션 -->
            <section id="uploadSection" class="card upload-section">
                <h2>스쿼트 영상 업로드</h2>
                <p class="text-muted">측면에서 촬영한 영상이 가장 정확한 분석을 제공합니다</p>
                
                <div class="upload-area" id="uploadArea">
                    <div class="upload-icon">📹</div>
                    <p>여기를 눌러 영상 선택</p>
                    <small>또는 파일을 드래그하세요</small>
                </div>
                
                <input type="file" id="videoInput" accept="video/*" style="display: none;">
                
                <div id="videoPreview" class="video-container" style="display: none;">
                    <video id="uploadedVideo" controls></video>
                </div>
                
                <div class="button-group" style="margin-top: 20px;">
                    <button id="analyzeBtn" class="btn btn-primary" disabled>
                        분석 시작하기
                    </button>
                </div>
            </section>

            <!-- 분석 중 섹션 -->
            <section id="analyzingSection" class="card analyzing" style="display: none;">
                <div class="spinner"></div>
                <h3>AI가 영상을 분석중입니다...</h3>
                <p id="analysisStatus">잠시만 기다려주세요</p>
                <div class="progress-bar">
                    <div class="progress-fill" id="progressFill"></div>
                </div>
                <small id="frameInfo" style="color: var(--gray-text);"></small>
            </section>

            <!-- 결과 섹션 -->
            <section id="resultsSection" class="results-section" style="display: none;">
                <!-- 점수 카드 -->
                <div class="card score-card">
                    <div class="score-meter">
                        <svg class="score-ring" viewBox="0 0 200 200">
                            <circle class="bg" cx="100" cy="100" r="90"></circle>
                            <circle class="progress" cx="100" cy="100" r="90"
                                    stroke-dasharray="565.48" stroke-dashoffset="565.48"></circle>
                        </svg>
                        <div class="score-center">
                            <div class="score-display" id="scoreDisplay">0</div>
                        </div>
                    </div>
                    <div class="score-label">종합 점수</div>
                    
                    <!-- 세부 점수 -->
                    <div class="score-breakdown">
                        <div class="score-item">
                            <div class="score-item-label">깊이</div>
                            <div class="score-item-value" id="depthScore">-</div>
                        </div>
                        <div class="score-item">
                            <div class="score-item-label">자세</div>
                            <div class="score-item-value" id="postureScore">-</div>
                        </div>
                        <div class="score-item">
                            <div class="score-item-label">균형</div>
                            <div class="score-item-value" id="balanceScore">-</div>
                        </div>
                        <div class="score-item">
                            <div class="score-item-label">속도</div>
                            <div class="score-item-value" id="speedScore">-</div>
                        </div>
                    </div>
                </div>

                <!-- AI 피드백 -->
                <div class="card">
                    <h3 style="margin-bottom: 20px;">AI 코치의 피드백</h3>
                    <div id="feedbackContainer"></div>
                </div>

                <!-- 액션 버튼 -->
                <div class="card" style="text-align: center;">
                    <button class="btn btn-primary" id="downloadBtn">
                        📱 인스타 스토리용 다운로드
                    </button>
                    <button class="btn btn-secondary" id="resetBtn" style="margin-left: 10px;">
                        새로운 영상 분석
                    </button>
                </div>
            </section>
        </main>
    </div>

    <!-- 캔버스 (분석용) -->
    <canvas id="outputCanvas" style="display: none;"></canvas>

    <!-- 디버그 패널 -->
    <div id="debugPanel" class="debug-panel"></div>

    <!-- JavaScript -->
    <script src="script.js"></script>
</body>
</html>
