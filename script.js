// 스쿼트 프레임 분석 (개선됨 - 더 엄격한 판정)
function analyzeSquatFrame(landmarks) {
    // 주요 관절 좌표
    const leftHip = landmarks[23];
    const leftKnee = landmarks[25];
    const leftAnkle = landmarks[27];
    const rightHip = landmarks[24];
    const rightKnee = landmarks[26];
    const rightAnkle = landmarks[28];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    
    // 더 엄격한 가시성 요구사항
    const minVisibility = 0.3; // 0.1에서 0.3으로 상향
    
    // 양쪽 다리의 평균값 사용
    let kneeAngleLeft = null;
    let kneeAngleRight = null;
    let backAngleLeft = null;
    let backAngleRight = null;
    
    // 왼쪽 측정
    if (leftHip && leftKnee && leftAnkle && leftShoulder &&
        leftHip.visibility > minVisibility && leftKnee.visibility > minVisibility && 
        leftAnkle.visibility > minVisibility) {
        kneeAngleLeft = calculateAngle(leftHip, leftKnee, leftAnkle);
        backAngleLeft = calculateAngle(leftShoulder, leftHip, leftKnee);
    }
    
    // 오른쪽 측정
    if (rightHip && rightKnee && rightAnkle && rightShoulder &&
        rightHip.visibility > minVisibility && rightKnee.visibility > minVisibility && 
        rightAnkle.visibility > minVisibility) {
        kneeAngleRight = calculateAngle(rightHip, rightKnee, rightAnkle);
        backAngleRight = calculateAngle(rightShoulder, rightHip, rightKnee);
    }
    
    // 양쪽 모두 측정되어야 함 (더 엄격)
    if (kneeAngleLeft === null || kneeAngleRight === null) {
        return null;
    }
    
    const kneeAngle = (kneeAngleLeft + kneeAngleRight) / 2;
    const backAngle = (backAngleLeft + backAngleRight) / 2;
    const hipY = (leftHip.y + rightHip.y) / 2;
    const kneeY = (leftKnee.y + rightKnee.y) / 2;
    const ankleY = (leftAnkle.y + rightAnkle.y) / 2;
    
    // 스쿼트 동작 특성 검증
    if (!isValidSquatPosture(kneeAngle, backAngle, hipY, kneeY, ankleY, leftHip, rightHip, leftKnee, rightKnee)) {
        return null;
    }
    
    // 깊이 계산 (더 엄격한 임계값)
    const depth = kneeAngle < 100 ? 'deep' : kneeAngle < 130 ? 'parallel' : 'shallow';
    
    return {
        timestamp: elements.uploadedVideo.currentTime,
        kneeAngle: kneeAngle,
        backAngle: backAngle,
        depth: depth,
        hipY: hipY,
        kneeY: kneeY,
        ankleY: ankleY,
        visibility: Math.min(
            leftHip.visibility,
            rightHip.visibility,
            leftKnee.visibility,
            rightKnee.visibility
        )
    };
}

// 스쿼트 자세 유효성 검사 (새로 추가)
function isValidSquatPosture(kneeAngle, backAngle, hipY, kneeY, ankleY, leftHip, rightHip, leftKnee, rightKnee) {
    // 1. 무릎 각도가 스쿼트 범위에 있는지 확인 (더 엄격)
    if (kneeAngle > 170 || kneeAngle < 70) {
        return false;
    }
    
    // 2. 허리 각도가 적절한지 확인 (허리를 펴고 있는지)
    if (backAngle < 60 || backAngle > 140) {
        return false;
    }
    
    // 3. 엉덩이가 무릎보다 아래에 있는지 확인 (스쿼트 특성)
    if (hipY <= kneeY) {
        return false;
    }
    
    // 4. 무릎이 발목보다 위에 있는지 확인
    if (kneeY >= ankleY) {
        return false;
    }
    
    // 5. 양쪽 다리의 균형 확인 (한쪽으로 기울어지지 않았는지)
    const hipBalance = Math.abs(leftHip.y - rightHip.y);
    const kneeBalance = Math.abs(leftKnee.y - rightKnee.y);
    
    if (hipBalance > 0.1 || kneeBalance > 0.1) {
        return false;
    }
    
    // 6. 발의 너비가 적절한지 확인 (스쿼트 스탠스)
    const footWidth = Math.abs(leftHip.x - rightHip.x);
    if (footWidth < 0.1 || footWidth > 0.8) {
        return false;
    }
    
    return true;
}

// 스쿼트 횟수 계산 (개선됨 - 더 엄격한 판정)
function countSquats() {
    if (squatData.length < 20) return 0; // 최소 프레임 수 증가
    
    let count = 0;
    let isDown = false;
    let consecutiveDownFrames = 0;
    let consecutiveUpFrames = 0;
    
    // 더 엄격한 스쿼트 카운트 로직
    for (let i = 0; i < squatData.length; i++) {
        const kneeAngle = squatData[i].kneeAngle;
        const hipY = squatData[i].hipY;
        const kneeY = squatData[i].kneeY;
        
        // 스쿼트 다운 동작 감지 (더 엄격)
        if (kneeAngle < 120 && hipY > kneeY + 0.05) {
            consecutiveDownFrames++;
            consecutiveUpFrames = 0;
            
            // 충분한 다운 프레임이 있어야 스쿼트로 인정
            if (consecutiveDownFrames >= 3 && !isDown) {
                isDown = true;
            }
        } 
        // 스쿼트 업 동작 감지 (더 엄격)
        else if (kneeAngle > 150 && isDown) {
            consecutiveUpFrames++;
            consecutiveDownFrames = 0;
            
            // 충분한 업 프레임이 있어야 완전한 스쿼트로 인정
            if (consecutiveUpFrames >= 3) {
                count++;
                isDown = false;
                consecutiveUpFrames = 0;
                // 다음 스쿼트 감지를 위한 최소 간격
                i += 10;
            }
        } else {
            // 중간 상태에서는 카운터 감소
            if (consecutiveDownFrames > 0) consecutiveDownFrames--;
            if (consecutiveUpFrames > 0) consecutiveUpFrames--;
        }
    }
    
    return count;
}

// 분석 완료 (개선됨 - 더 엄격한 검증)
function completeAnalysis() {
    console.log('분석 완료 함수 호출');
    
    isAnalyzing = false;
    
    if (elements.uploadedVideo) {
        elements.uploadedVideo.pause();
        elements.uploadedVideo.currentTime = 0;
    }
    
    if (analysisTimeout) {
        clearTimeout(analysisTimeout);
        analysisTimeout = null;
    }
    
    window.lastFrameTime = null;
    
    // 데이터 충분성 체크 (더 엄격)
    if (squatData.length < 20) {
        console.log(`분석 실패: 수집된 데이터 ${squatData.length}개 (최소 20개 필요)`);
        showError('충분한 스쿼트 동작을 감지하지 못했습니다. 정면 또는 측면에서 촬영한 명확한 스쿼트 영상을 사용해주세요.');
        resetApp();
        return;
    }
    
    // 스쿼트 품질 검증 추가
    const validSquatFrames = squatData.filter(data => {
        return data.kneeAngle >= 70 && data.kneeAngle <= 170 && 
               data.backAngle >= 60 && data.backAngle <= 140 &&
               data.hipY > data.kneeY + 0.02; // 엉덩이가 무릎보다 충분히 아래
    });
    
    if (validSquatFrames.length < squatData.length * 0.6) {
        console.log(`분석 실패: 유효한 스쿼트 프레임 ${validSquatFrames.length}/${squatData.length}`);
        showError('스쿼트 동작이 명확하지 않습니다. 올바른 스쿼트 자세로 촬영해주세요.');
        resetApp();
        return;
    }
    
    const results = calculateResults();
    
    // 스쿼트 카운트가 0이면 분석 실패
    if (results.squatCount === 0) {
        console.log('분석 실패: 스쿼트 동작 감지되지 않음');
        showError('스쿼트 동작을 감지할 수 없습니다. 완전한 스쿼트 동작(앉았다 일어나기)을 수행해주세요.');
        resetApp();
        return;
    }
    
    elements.analyzingSection.style.display = 'none';
    elements.resultsSection.style.display = 'block';
    updateStep(3);
    
    displayResults(results);
}
