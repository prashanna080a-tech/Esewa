export function createStabilityGate({ requiredPasses, maxAgeMs }) {
  let passCount = 0;
  let lastPassAt = 0;

  function reset() {
    passCount = 0;
    lastPassAt = 0;
  }

  function observe(report) {
    if (!report || report.status !== "pass") {
      passCount = 0;
      lastPassAt = 0;
      return { passCount, isSatisfied: false };
    }

    const now = report.capturedAt ?? Date.now();
    if (lastPassAt && now - lastPassAt > maxAgeMs) {
      passCount = 0;
    }

    passCount += 1;
    lastPassAt = now;

    return { passCount, isSatisfied: passCount >= requiredPasses };
  }

  return { reset, observe };
}

