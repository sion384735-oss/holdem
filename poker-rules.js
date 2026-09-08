function contestableRaiseTarget(player, players, requestedRoundTarget) {
  const requested = Math.max(player.roundBet, Math.floor(Number(requestedRoundTarget) || 0));
  const opponents = players.filter(other => other.id !== player.id && other.inHand && !other.folded);
  if (!opponents.length) return player.roundBet;
  const deepestOpponentTotal = Math.max(...opponents.map(other => other.totalBet + other.stack));
  const contestableAdditional = Math.max(0, deepestOpponentTotal - player.totalBet);
  const contestableRoundTarget = player.roundBet + Math.min(player.stack, contestableAdditional);
  return Math.min(requested, contestableRoundTarget);
}

function uncalledExcess(players) {
  const contributors = players
    .filter(player => player.inHand && player.totalBet > 0)
    .sort((left, right) => right.totalBet - left.totalBet);
  if (contributors.length < 2 || contributors[0].totalBet === contributors[1].totalBet) return null;
  return {
    playerId: contributors[0].id,
    amount: contributors[0].totalBet - contributors[1].totalBet
  };
}

function buildPotLayers(players) {
  const levels = [...new Set(players
    .filter(player => player.inHand && player.totalBet > 0)
    .map(player => player.totalBet))].sort((a, b) => a - b);
  let previous = 0;
  return levels.map((level, index) => {
    const contributors = players.filter(player => player.inHand && player.totalBet >= level);
    const eligibleIds = contributors.filter(player => !player.folded).map(player => player.id);
    const amount = (level - previous) * contributors.length;
    previous = level;
    return {
      index,
      type: index === 0 ? 'main' : 'side',
      label: index === 0 ? 'MAIN POT' : `SIDE POT ${index}`,
      amount,
      cap: level,
      contributorIds: contributors.map(player => player.id),
      eligibleIds
    };
  }).filter(pot => pot.amount > 0 && pot.eligibleIds.length > 0);
}

module.exports = { contestableRaiseTarget, uncalledExcess, buildPotLayers };
