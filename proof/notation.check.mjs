/* Does the written form hold up when someone edits it?
 *
 * The line is meant to travel through places nobody can check it — a commit
 * message, a stone, an issue, a chat window. So the two properties that matter
 * are not conveniences, they are the whole design, and they are asserted here
 * rather than described in a comment:
 *
 *   changing the LABEL must NOT invalidate a line   (the label is a comment)
 *   changing a MEMBER must invalidate it            (the members are the identity)
 *
 * Five times in one night this estate mistook a name for an identity. A notation
 * designed after that rule was written, which then keyed on its name, would be
 * indefensible. This is the rule made checkable.
 */
import { format, parse, collect, canonical, idOf } from '../iterations/49-read-the-line/notation.mjs';
import { createHash } from 'node:crypto';

const fail = [];
const say = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fail.push(msg); };

const KEYS = [192067, 192068, 192069, 1416, 2];
const line = await format({ label: 'how far apart', keys: KEYS });
console.log('line: ' + line + '\n');

/* 1. The id is reproducible by anyone, with no code of ours. */
const shell = createHash('sha256').update(canonical(KEYS)).digest('hex').slice(0, 12);
const inLine = line.slice('ventus:set/'.length, 'ventus:set/'.length + 12);
say(shell === inLine,
  `the id is a plain SHA-256 anyone can reproduce: printf '${canonical(KEYS)}' | sha256sum -> ${shell}`);

/* 2. Round trip, and the maker's order is preserved while only the hash sorts. */
const r = await parse(line);
say(r.ok && r.keys.join(',') === KEYS.join(','),
  'a line parses back to the same members, in the order the maker chose');
say(canonical(KEYS) !== KEYS.join(','),
  'and that order is NOT the hashed order, so the two are genuinely different things');

/* 3. THE LABEL IS A COMMENT. Rewriting it must change nothing. */
const relabelled = line.replace('"how far apart"', '"the distance between two points"');
const r2 = await parse(relabelled);
say(r2.ok && r2.id === r.id,
  'changing the label leaves the line valid and the id identical — the label carries no identity');

/* 4. THE MEMBERS ARE THE IDENTITY. Editing one must be caught. */
const tampered = line.replace('192069', '192070');
const r3 = await parse(tampered);
say(!r3.ok, 'editing a single member is refused: ' + (r3.why || '').slice(0, 96));

/* 5. And editing the id instead of the members is caught the same way. */
const forged = 'ventus:set/000000000000' + line.slice(line.indexOf(' '));
say(!(await parse(forged)).ok, 'editing the id rather than the members is refused too');

/* 6. There is no unverified path. A caller cannot get members out of a bad line. */
say(r3.ok === false && r3.keys !== undefined && !('label' in r3 && r3.ok),
  'a refused line yields no usable set — verification is mandatory, not offered');

/* 7. Two people choosing the same lines in different orders write the same id.
      This is the property the whole mission rests on: a person clicking and a
      model writing must produce the identical line. */
const shuffled = [...KEYS].reverse();
say(await idOf(shuffled) === await idOf(KEYS),
  'the same lines chosen in a different order produce the SAME id — agreement is detectable');

/* 8. A receiver keys on the hash. One set under two labels is one proposal. */
const stone = `
some prose about the night
${line}
${relabelled}
ventus:set/deadbeefcafe "a lie" 1,2,3
`;
const c = await collect(stone);
say(c.sets.length === 1,
  `two labels over the same members collect as ONE proposal, not two (${c.sets.length} set, ${c.sets[0]?.labels.length} labels)`);
say(c.refused.length === 1 && /altered/.test(c.refused[0].why),
  'and a forged line in the same text is refused rather than collected');

/* 9. What it does not claim. */
const unissued = await format({ label: 'keys that were never issued', keys: [999999991, 999999992] });
const r4 = await parse(unissued);
say(r4.ok, 'a line of keys that were never issued still VERIFIES — the check is integrity, not truth');
say(/intact, not true/.test(r4.note || ''), 'and the result says so in the answer, not only in a comment');

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
