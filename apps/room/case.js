/* ───────────────────────────────────────────────────────────────────────────
   room/case.js — the study, the people in it, and what is true.

   A mystery is only a mystery if it can be got wrong. That means the clues
   have to point somewhere plausible and wrong before they point somewhere
   right, and it means the reader has to be able to *check* — which is the part
   that is usually faked. Most whodunnits in a browser are a list of paragraphs
   and a multiple choice at the end.

   So the case is data. Every object holds facts, every fact belongs to a
   claim, and two facts about the same claim that disagree are a contradiction
   the code can find rather than one the writer remembered to mention. That is
   what makes the notebook honest: it is not a list of things I decided were
   interesting, it is everything you have actually turned over.
   ─────────────────────────────────────────────────────────────────────────── */

export const SETTING = {
  title: 'The Room',
  where: 'The study at Harkness Hall',
  when: 'Thursday, 11 March — the morning after',
  dead: 'Edmund Harkness',
  brief:
    'Edmund Harkness was found at his desk at seven this morning by the housekeeper. '
    + 'The doctor says he died somewhere between nine and eleven last night. '
    + 'The door was locked from the inside and the key was in his pocket. '
    + 'Nobody has been allowed in since. Look at whatever you like.',
};

/* ── the people ──────────────────────────────────────────────────────────── */

export const SUSPECTS = [
  {
    id: 'clara',
    name: 'Clara Harkness',
    role: 'His wife',
    alibi: 'In the drawing room with the vicar from nine until eleven.',
  },
  {
    id: 'victor',
    name: 'Victor Harkness',
    role: 'His brother, and his business partner',
    alibi: 'Drove to town at half past eight and came back after midnight.',
  },
  {
    id: 'mrs-pike',
    name: 'Mrs Pike',
    role: 'The housekeeper, thirty-one years',
    alibi: 'In her room from nine. Found him at seven this morning.',
  },
  {
    id: 'daniel',
    name: 'Daniel Ashe',
    role: 'His secretary',
    alibi: 'Left at six. Says he went home and stayed there.',
  },
];

/* ── what can be true ────────────────────────────────────────────────────────
   A claim is one plain proposition about the night, and every fact assigns it
   a value. Two known facts that assign the same claim different values are a
   contradiction — found by comparing them, not by a list somewhere of pairs I
   remembered to write down.

   That distinction is the whole design. A hand-written list of contradictions
   goes stale the moment the story is edited, and worse, it lets the writer
   cheat: the game can appear to reason while really just reading out answers.
   Here the reasoning is three lines long and it cannot be fooled, because
   nothing in this file knows which fact is the lie. */

export const CLAIMS = {
  'clock-honest':   { q: 'Whether the mantel clock stopped by itself', yes: 'It stopped on its own at 10.14', no: 'It was set and stopped by hand' },
  'victor-in-town': { q: 'Whether Victor went to town', yes: 'He went', no: 'He never left' },
  'daniel-home':    { q: 'Whether Daniel Ashe went home at six', yes: 'He went home and stayed', no: 'He came back' },
  'alone':          { q: 'Whether Edmund was alone at his desk', yes: 'He was alone', no: 'Somebody drank with him' },
  'sealed-room':    { q: 'Whether the locked door means nobody left', yes: 'Nobody could have left', no: 'The key could be put back' },
  'window-opened':  { q: 'Whether the window was opened', yes: 'It was opened', no: 'It has not been opened in a year' },
  'edmund-wrote':   { q: 'Whether Edmund was writing that night', yes: 'He was writing', no: 'He wrote nothing' },
  'victor-exposed': { q: 'Whether Edmund had found Victor out', yes: 'Edmund had the accounts', no: 'Nothing criminal passed between them' },
  'who-gains':      { q: 'Who the new will favours', clara: 'Clara gains the business', victor: 'Victor keeps the business' },
};

/* ── the room ────────────────────────────────────────────────────────────────
   Each thing you can look at. `needs` is what has to be found first, which is
   how the case opens out rather than arriving all at once.

   `note` is what you see. `facts` is what it tells you, and a fact is only
   recorded once you have actually looked. */

export const OBJECTS = [
  {
    id: 'desk',
    name: 'The desk',
    at: { x: 0.345, y: 0.6 },
    note:
      'Mahogany, and tidy in a way that suggests somebody tidied it. A blotter, a pen laid '
      + 'straight, an appointments diary open at today. Edmund was found in the chair behind it.',
    facts: [],
    reveals: ['diary', 'drawer', 'blotter'],
  },
  {
    id: 'diary',
    name: 'The appointments diary',
    at: { x: 0.652, y: 0.522 },
    needs: 'desk',
    note:
      'Thursday is blank. Wednesday — last night — has one line, in Edmund\u2019s hand: '
      + '"D. A. 9.30. Have it out with him." It has not been crossed off.',
    facts: [
      { claim: 'daniel-home', value: 'no', says: 'Edmund wrote that he expected Daniel Ashe here at half past nine' },
    ],
  },
  {
    id: 'drawer',
    name: 'The locked drawer',
    at: { x: 0.411, y: 0.605 },
    needs: 'desk',
    note:
      'Locked, and the lock is scratched around the keyhole — recently; the brass is bright in '
      + 'the scratches. Inside: a new will, signed and witnessed a fortnight ago, and an older '
      + 'one underneath it.',
    facts: [
      { claim: 'sealed-room', value: 'no', says: 'Somebody picked this drawer, so somebody in this house picks locks' },
    ],
    reveals: ['will'],
  },
  {
    id: 'will',
    name: 'The new will',
    at: { x: 0.38, y: 0.648 },
    needs: 'drawer',
    note:
      'The old will left the business to Victor. The new one leaves it to Clara, and leaves '
      + 'Victor a sum of money described as "sufficient". Signed. Witnessed by Mrs Pike and by '
      + 'Daniel Ashe.',
    facts: [
      { claim: 'who-gains', value: 'clara', says: 'The new will gives Clara the business and cuts Victor out' },
    ],
  },
  {
    id: 'blotter',
    name: 'The blotter',
    at: { x: 0.53, y: 0.55 },
    needs: 'desk',
    note:
      'Clean, except for the ghost of one line pressed through from a sheet above it. Held to '
      + 'the window it reads, backwards: "— cannot pretend I did not see it, and I will not —"',
    facts: [
      { claim: 'edmund-wrote', value: 'yes', says: 'A line pressed through the blotter: he was writing to somebody' },
    ],
  },
  {
    id: 'glass',
    name: 'The glass',
    at: { x: 0.63, y: 0.556 },
    note:
      'One glass, on the right of the blotter, with an inch of whisky left in it. Edmund was '
      + 'left-handed — the pen rests on the left of the blotter and the chair is pushed back on '
      + 'that side.',
    facts: [
      { claim: 'alone', value: 'no', says: 'The glass was set down on the right. Edmund was left-handed' },
    ],
  },
  {
    id: 'decanter',
    name: 'The decanter',
    at: { x: 0.711, y: 0.516 },
    note:
      'Three-quarters full, stopper off, on the side table. There are two rings in the dust on '
      + 'the table where glasses have stood. Only one glass is in the room.',
    facts: [
      { claim: 'alone', value: 'no', says: 'Two glasses stood on the side table. One of them has left the house' },
    ],
  },
  {
    id: 'fire',
    name: 'The fireplace',
    at: { x: 0.195, y: 0.5 },
    note:
      'Cold, and swept — but not well. A corner of stiff paper has survived at the back of the '
      + 'grate, scorched brown. Two words are legible: "…your brother…"',
    facts: [
      { claim: 'edmund-wrote', value: 'yes', says: 'A letter was burnt in this grate' },
    ],
    reveals: ['scrap'],
  },
  {
    id: 'scrap',
    name: 'The scorched corner',
    at: { x: 0.196, y: 0.588 },
    needs: 'fire',
    note:
      'Held to the light, more comes up in the scorching: "…the accounts for the last four years '
      + 'are not what your brother has been showing the bank, and I am obliged to…"',
    facts: [
      { claim: 'victor-exposed', value: 'yes', says: 'Edmund had found that Victor was falsifying the accounts' },
    ],
  },
  {
    id: 'window',
    name: 'The window',
    at: { x: 0.921, y: 0.33 },
    note:
      'Shut, and latched. The latch is stiff and the paint across the frame is unbroken — this '
      + 'window has not been opened in a year. There is a flowerbed below it, outside.',
    facts: [
      { claim: 'window-opened', value: 'no', says: 'The paint across the frame is unbroken' },
    ],
    reveals: ['flowerbed'],
  },
  {
    id: 'flowerbed',
    name: 'The flowerbed, through the glass',
    at: { x: 0.95, y: 0.585 },
    needs: 'window',
    note:
      'Wet earth, and one clear boot print under the window, pointing at the wall. A man\u2019s, '
      + 'and deep — whoever made it stood there a while. Nothing else is disturbed.',
    /* A man stood in the rain looking up at a window that has not opened in a
       year. It is the most sinister thing in the room and it means nothing:
       the gardener, a poacher, anybody. Every case needs one, or a reader
       learns that anything the game bothers to draw is evidence. */
    facts: [],
  },
  {
    id: 'clock',
    name: 'The mantel clock',
    at: { x: 0.193, y: 0.318 },
    note:
      'Stopped at 10.14. It is an eight-day clock and it was wound on Sunday, so it had no '
      + 'business stopping. The case is closed and the glass is unbroken.',
    facts: [
      { claim: 'clock-honest', value: 'yes', says: 'The clock reads 10.14 and was wound on Sunday' },
    ],
    reveals: ['clock-back'],
  },
  {
    id: 'clock-back',
    name: 'The back of the clock',
    at: { x: 0.232, y: 0.294 },
    needs: 'clock',
    note:
      'The movement is sound and the spring still has tension in it. Somebody opened the case '
      + 'and moved the hands — there are fresh scratches on the arbor — then stopped the '
      + 'pendulum by hand.',
    facts: [
      { claim: 'clock-honest', value: 'no', says: 'The hands were moved and the pendulum stopped by hand' },
    ],
  },
  {
    id: 'body',
    name: 'Edmund',
    at: { x: 0.5, y: 0.478 },
    note:
      'In the chair, head forward on the desk. No wound and no mark on him. The doctor says his '
      + 'heart — and the doctor also says he would not stake his reputation on it.',
    facts: [],
    reveals: ['hands', 'pocket'],
  },
  {
    id: 'hands',
    name: 'His hands',
    at: { x: 0.436, y: 0.538 },
    needs: 'body',
    note:
      'The right cuff is clean. The left is smudged along its edge, the way a left-handed man '
      + 'smudges his own ink. There is no ink on the blotter and no letter on the desk.',
    facts: [
      { claim: 'edmund-wrote', value: 'yes', says: 'Wet ink on his left cuff, and nothing written left in the room' },
    ],
  },
  {
    id: 'pocket',
    name: 'His pockets',
    at: { x: 0.566, y: 0.532 },
    needs: 'body',
    note:
      'A watch, stopped at ten past four — it wants winding, nothing more. The key to this room. '
      + 'And a folded note in another hand: "I am coming at nine. Do not see V. before you see '
      + 'me. — D.A."',
    facts: [
      { claim: 'daniel-home', value: 'no', says: 'Daniel Ashe wrote to say he was coming at nine' },
    ],
  },
  {
    id: 'rug',
    name: 'The rug',
    at: { x: 0.43, y: 0.78 },
    note:
      'Turkish, and heavy. One corner is folded under, and there is a drag mark in the pile from '
      + 'the door towards the desk. Under the fold, a smear of wet earth.',
    facts: [
      { claim: 'alone', value: 'no', says: 'Wet earth was carried in from outside, after the rain started' },
    ],
  },
  {
    id: 'door',
    name: 'The door',
    at: { x: 0.128, y: 0.5 },
    note:
      'Locked from the inside, as everybody says, and the key was in Edmund\u2019s pocket. But '
      + 'this is an old house: the gap under the door is wide enough to put a hand through flat.',
    facts: [
      { claim: 'sealed-room', value: 'no', says: 'A key can be pushed back under this door on the flat of a hand' },
    ],
  },
  {
    id: 'coat',
    name: 'The coat stand',
    at: { x: 0.096, y: 0.74 },
    note:
      'Edmund\u2019s coat, and under it a second one that is not his: wet at the shoulders, and '
      + 'in the pocket a town ticket for the 8.40 — Wednesday\u2019s date, outward half only, '
      + 'and never clipped.',
    facts: [
      { claim: 'victor-in-town', value: 'no', says: 'An outward ticket for the 8.40, bought and never used' },
      { claim: 'alone', value: 'no', says: 'A coat that is not Edmund\u2019s is hanging in this room' },
    ],
  },
];

/* ── the statements ──────────────────────────────────────────────────────────
   Statements carry facts of exactly the same shape as the room does, and that
   is the whole design: a statement that disagrees with a boot print is found
   by the same three lines that find any other disagreement. Nothing anywhere
   marks one of these as the lie. */

export const STATEMENTS = [
  {
    who: 'clara',
    text:
      '"I was with the vicar until eleven; he will tell you so. Edmund had been strange for a '
      + 'fortnight — since he changed the will, though he would not say why. No, I did not come '
      + 'in here. I have not been in this room since Sunday."',
    facts: [
      { claim: 'who-gains', value: 'clara', says: 'Clara says Edmund changed the will a fortnight ago' },
    ],
  },
  {
    who: 'victor',
    text:
      '"I drove to the station and took the 8.40, and I was at my club until well after '
      + 'midnight. Ask anyone there. I have not set foot in this study for a week. As for the '
      + 'accounts — my brother and I disagreed about a great many things, and none of them were '
      + 'criminal."',
    facts: [
      { claim: 'victor-in-town', value: 'yes', says: 'Victor says he took the 8.40 and was at his club all night' },
      { claim: 'victor-exposed', value: 'no', says: 'Victor says nothing criminal passed between them' },
    ],
  },
  {
    who: 'mrs-pike',
    text:
      '"I went up at nine and I did not come down. I heard him moving about — you can hear that '
      + 'chair on the boards from my room. I heard it at about half past ten, and then I heard '
      + 'nothing, and I thought he had gone to bed."',
    facts: [
      { claim: 'alone', value: 'yes', says: 'Mrs Pike heard one chair, one man, and no voices' },
    ],
  },
  {
    who: 'daniel',
    text:
      '"I left at six and went straight home. I did not come back. Whatever he wrote in his '
      + 'diary, he did not write it with me. I had nothing to have out with him about."',
    facts: [
      { claim: 'daniel-home', value: 'yes', says: 'Daniel Ashe says he left at six and never returned' },
    ],
  },
];

/* ── the answer ──────────────────────────────────────────────────────────────
   Kept in one place, and only used to mark the accusation. Nothing above
   knows it, which is why the contradictions are real rather than staged. */

export const SOLUTION = {
  guilty: 'victor',
  /* The objects a reader must have turned over for their accusation to be
     something they worked out rather than something they guessed. */
  proof: ['coat', 'scrap', 'clock-back', 'glass'],
  because:
    'Victor never went to town. The outward half of the 8.40 ticket is unclipped in the pocket '
    + 'of a coat that is still hanging in this room — he bought it to be seen buying it and he '
    + 'never boarded. He came back in the wet, drank a whisky at his brother’s desk with '
    + 'his right hand, and took his own glass away with him. He burnt the letter that said what '
    + 'Edmund had found in the accounts, and he took the page Edmund had been writing. Then he '
    + 'put the clock back, stopped it at a quarter past ten, and let himself out — pushing the '
    + 'key back under the door on the flat of his hand.',
  missed: {
    clara:
      'Clara gains the business, and she is the only one who does. That is exactly why it is '
      + 'not her: the will was signed a fortnight ago and witnessed, and killing him changed '
      + 'nothing she did not already have.',
    'mrs-pike':
      'Mrs Pike heard a chair at half past ten and said so, which is the one piece of testimony '
      + 'that puts somebody alive in this room late. A woman covering a murder does not invent a '
      + 'witness statement that narrows the window she has to account for.',
    daniel:
      'Daniel Ashe lied — he did come back, and the note in Edmund’s pocket proves he meant '
      + 'to. But he came at nine to warn him about Victor, and he lied afterwards because a '
      + 'secretary who was the last man in the room is a secretary who hangs. The second coat is '
      + 'not his: his own was on him when he left at six, and the ticket in it is for a train he '
      + 'had no reason to take.',
  },
};
