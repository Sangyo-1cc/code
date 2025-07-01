// ui.js

// UI 제어 함수 모듈

export function updateStatus(message, isLoading = false) {
    const statusElement = document.getElementById('status');
    if (statusElement) statusElement.innerHTML = isLoading ? `<span class="loading"></span> ${message}` : message;
}

export function showRegularResults() {
    const storyCanvasContainer = document.getElementById('story-canvas-container');
    const noSquatResultArea = document.getElementById('no-squat-result-area');
    const coachFeedbackArea = document.getElementById('coach-feedback-area');
    const shareStoryBtn = document.getElementById('shareStoryBtn');
    if(storyCanvasContainer) storyCanvasContainer.style.display = 'block';
    if(noSquatResultArea) noSquatResultArea.style.display = 'none';
    if(coachFeedbackArea) coachFeedbackArea.style.display = 'block';
    if(shareStoryBtn) shareStoryBtn.style.display = 'block';
}

export function showNoSquatResults() {
    const noSquatResultArea = document.getElementById('no-squat-result-area');
    const storyCanvasContainer = document.getElementById('story-canvas-container');
    const coachFeedbackArea = document.getElementById('coach-feedback-area');
    const shareStoryBtn = document.getElementById('shareStoryBtn');
    if(noSquatResultArea) {
        noSquatResultArea.innerHTML = `
            <div class="no-result-icon">🤖</div>
            <h2>분석 실패!</h2>
            <p>유효한 스쿼트 동작을 인식하지 못했습니다.</p>
            <p class="help-text">자세나 영상 각도를 확인 후 다시 시도해보세요.</p>
        `;
        noSquatResultArea.style.display = 'block';
    }
    if(storyCanvasContainer) storyCanvasContainer.style.display = 'none';
    if(coachFeedbackArea) coachFeedbackArea.style.display = 'none';
    if(shareStoryBtn) shareStoryBtn.style.display = 'none';
} 