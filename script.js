// 개선된 스쿼트 분석 함수를 포함하는 클래스
class SquatAnalyzer {
constructor() {
        // 모든 메서드에 'this' 바인딩
        this.smoothAngle = this.smoothAngle.bind(this);
        this.calculateMovementVelocity = this.calculateMovementVelocity.bind(this);
        this.validateSquatQuality = this.validateSquatQuality.bind(this);
        this.detectNonSquatMovement = this.detectNonSquatMovement.bind(this);
        this.analyzeBetterSquat = this.analyzeBetterSquat.bind(this);
        this.reset = this.reset.bind(this); // reset 메서드도 바인딩

this.angleHistory = [];
this.velocityHistory = [];
this.SMOOTHING_WINDOW = 3;
@@ -189,6 +197,12 @@ class SquatAnalyzer {
this.repReachedMinDepth = false; // 클래스 내부에서 최소 깊이 도달 여부 관리
this.bottomHoldFrames = 0; // 클래스 내부에서 최하점 유지 프레임 관리

        this.squatQualityChecks = {
            hasProperDepth: false,
            hasControlledMovement: false,
            hasSymmetricMovement: false
        };

// 임계값 (당신 제안 반영)
this.STANDING_KNEE_THRESHOLD = 160;     // 서있는 상태
this.DESCENDING_KNEE_THRESHOLD = 150;   // 하강 시작
@@ -288,7 +302,7 @@ class SquatAnalyzer {
const requiredLandmarks = [11, 12, 23, 24, 25, 26, 27, 28]; // 어깨, 엉덩이, 무릎, 발목

if (!landmarks || landmarks.length === 0 || !landmarks[0]) {
            if (DEBUG_MODE) console.warn("LANDMARK_STATUS: 랜드마크 데이터 없음. 스쿼트 분석 건너뜜.");
            if (DEBUG_MODE) console.warn("LANDMARK_STATUS: 랜드마크 데이터 없음. 스쿼트 분석 건너뜀.");
return;
}

@@ -600,7 +614,8 @@ function processVideoFrame() {
if (result.landmarks && result.landmarks.length > 0) {
drawingUtils.drawLandmarks(result.landmarks[0], {color: '#FFC107', lineWidth: 2});
drawingUtils.drawConnectors(result.landmarks[0], PoseLandmarker.POSE_CONNECTIONS, {color: '#FFFFFF', lineWidth: 2});
            // SquatAnalyzer의 메인 분석 함수 호출
            // SquatAnalyzer의 메인 분석 함수 호출 (this 컨텍스트 유지)
            // analyzeBetterSquat는 SquatAnalyzer 클래스의 메서드이므로, squatAnalyzer 객체를 통해 호출해야 함
squatAnalyzer.analyzeBetterSquat(result.landmarks);
} else {
console.log("POSE_DETECTION_STATUS: 랜드마크가 감지되지 않음 (MediaPipe로부터 결과 없음).");
