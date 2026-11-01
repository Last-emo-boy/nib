// Confetti: small pieces scattered over the box at random angles.
// @input count 60 1..600 Pieces
// @input colors "#FF6B6B, #FFD93D, #6BCB77, #4D96FF" Colors
// @input size 10 2..40 Piece size
function render(input, size) {
  const colors = String(input.colors).split(/[,\s]+/).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
  const pieces = [];
  for (let i = 0; i < Math.min(input.count, 1000); i++) {
    const long = Math.random() < 0.6;
    const w = input.size * (long ? 0.45 : 1), h = input.size * (long ? 1.3 : 1);
    const round = Math.random() < 0.3;
    pieces.push({
      type: round ? 'ellipse' : 'rectangle',
      x: Math.random() * (size.width - w), y: Math.random() * (size.height - h), width: w, height: h,
      rotation: Math.round(Math.random() * 360), ...(round ? {} : { cornerRadius: long ? 1 : 2 }),
      fill: colors.length ? colors[Math.floor(Math.random() * colors.length)] : '#FF6B6B',
    });
  }
  return pieces;
}
