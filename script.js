async function endAnalysis() {
    updateStatus('✅ 분석 완료!');
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (analysisSection) analysisSection.style.display = 'none';
    if (resultSection) resultSection.style.display = 'block';

    if (squatCount > 0) {
        showRegularResults();
        const finalScores = {
            depth: squatAnalyzer.frameCount > 0 ? Math.round(squatAnalyzer.totalScores.depth / squatAnalyzer.frameCount) : 0,
            backPosture: squatAnalyzer.frameCount > 0 ? Math.round(squatAnalyzer.totalScores.backPosture / squatAnalyzer.frameCount) : 0
        };
        const finalTotalScore = Math.round((finalScores.depth + finalScores.backPosture) / 2);
        let finalFeedback = getQualitativeFeedback(finalTotalScore);
        const specificFeedbacks = Array.from(squatAnalyzer.feedbackMessages);
        if (specificFeedbacks.length > 0) {
            finalFeedback += `<br><br><strong>[AI 코치의 조언 💡]</strong><ul>`;
            specificFeedbacks.forEach(msg => {
                finalFeedback += `<li>${msg}</li>`;
            });
            finalFeedback += "</ul>";
        }
        await createShareableImage(finalTotalScore, finalFeedback);
        if (feedbackList) feedbackList.innerHTML = finalFeedback;
    } else {
        showNoSquatResults();
    }
}
