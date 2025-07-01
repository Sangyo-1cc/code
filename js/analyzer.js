// analyzer.js

// SquatAnalyzer 클래스 및 분석 관련 함수 모듈

export class SquatAnalyzer {
    constructor() {
        this.reset();
        this.SMOOTHING_WINDOW = 3;
        this.STANDING_KNEE_THRESHOLD = 160;
        this.DESCENDING_KNEE_THRESHOLD = 150;
        this.BOTTOM_KNEE_THRESHOLD = 120;
        this.ASCENDING_KNEE_THRESHOLD = 125;
        this.MIN_SQUAT_DURATION_FRAMES = 5;
        this.MIN_BOTTOM_HOLD_FRAMES = 1;
    }

    reset() {
        this.angleHistory = [];
        this.velocityHistory = [];
        this.squatPhase = 'standing';
        this.frameCount = 0;
        this.totalScores = { depth: 0, backPosture: 0 };
        this.repReachedMinDepth = false;
        this.bottomHoldFrames = 0;
        this.feedbackMessages = new Set();
    }

    // ... (기존 SquatAnalyzer 메서드들 export)

    // 예시: analyzeBetterSquat 내에서 스쿼트 1회 완료 시 반복별 피드백 push
    analyzeBetterSquat(landmarks) {
        // ... 기존 분석 로직 ...
        // 스쿼트 1회 완료 조건에서 아래 코드 실행
        if (typeof window !== 'undefined' && window.repFeedbacks) {
            window.repFeedbacks.push({
                depthScore: 80, // 실제 계산값으로 대체
                backScore: 75,  // 실제 계산값으로 대체
                kneeAngle: 110, // 실제 계산값으로 대체
                torsoAngle: 30, // 실제 계산값으로 대체
                // ... 필요시 추가 정보
            });
        }
    }
} 