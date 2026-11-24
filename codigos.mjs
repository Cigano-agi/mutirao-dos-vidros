// Gera códigos novos, um por função. Guarde a saída; não fica em arquivo nenhum.
import { randomInt } from 'node:crypto';
import { PAPEIS } from './api.mjs';
const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // sem 0/O, 1/I/L
const novo = () => Array.from({ length: 8 }, () => A[randomInt(A.length)]).join('').replace(/^(.{4})/, '$1-');
const pares = PAPEIS.map(p => [p, novo()]);
for (const [p, c] of pares) console.log(p.padEnd(10), c);
console.log('\nCODIGOS=' + pares.map(x => x.join(':')).join(','));
