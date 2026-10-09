// Jawaban pembanding manual (disusun dari aturan dampak 02-technical-design.md, bukan dari output engine).
// WAJIB ditinjau orang yang memahami produksi acara sebelum dianggap oracle final.
//
// AT-01: Panel 20.05→19.15 dan Talent B 19.15→20.05 berubah.
//   Panel: PIC mc, stage; resource res-panel(stage), res-mic(audio)
//   Talent B: PIC lo, audio; resource res-band(audio, stage), res-light(lighting)
//   Closing tidak berubah, pendahulunya (D-03, D-05) berubah → PIC mc, lighting FYI (kalah oleh ACTION).
export const AT01_ORACLE = {
  action: ['audio', 'lighting', 'lo', 'mc', 'stage'],
  fyi: [] as string[],
  unchanged: ['koordinator', 'led'],
}
