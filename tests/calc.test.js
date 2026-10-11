// Pruebas de las calculadoras. Uso: node tests/calc.test.js  (sin dependencias)
// Cada caso documenta su premisa y el resultado esperado calculado a mano.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require(path.join(__dirname, '..', 'assets', 'calc-core.js'));
const RULES = require(path.join(__dirname, '..', 'data', 'calc-rules.json'));
const TODAY = '2026-10-10';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.log('  ✘ ' + name + '\n    ' + e.message.split('\n').join('\n    ')); }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg || ''} esperado ${b}, obtenido ${a}`);
const base = (o = {}) => Object.assign({ inco: 'FOB', precio: '10000', flete: '1200', seguro: '60', di: '16', origin: 'extra', iva: '21',
  situacion: 'ri', destino: 'cambio', piibb: '2,5', despachante: '', terminal: '', fleteint: '', otros: '', tc: '' }, o);
const imp = o => C.computeImport(base(o), RULES, { today: TODAY });

console.log('Números en formato argentino');
test('1.250,50 → 1250,5', () => assert.equal(C.parseAmount('1.250,50').value, 1250.5));
test('10.000 → 10000 (punto de miles)', () => assert.equal(C.parseAmount('10.000').value, 10000));
test('1.000.000 → 1000000', () => assert.equal(C.parseAmount('1.000.000').value, 1000000));
test('2,5 y 2.5 → 2,5', () => { assert.equal(C.parseAmount('2,5').value, 2.5); assert.equal(C.parseAmount('2.5').value, 2.5); });
test('0.500 → 0,5 (no se toma como 500)', () => assert.equal(C.parseAmount('0.500').value, 0.5));
test('USD 1.200 y 16 % → 1200 y 16', () => { assert.equal(C.parseAmount('USD 1.200').value, 1200); assert.equal(C.parseAmount('16 %').value, 16); });
test('vacío → sin dato (no 0 silencioso)', () => assert.equal(C.parseAmount('').empty, true));
test('1,250.50 → error por formato ambiguo', () => assert.equal(C.parseAmount('1,250.50').ok, false));
test('-5 → error (negativo)', () => assert.equal(C.parseAmount('-5').ok, false));
test('abc y 12a → error', () => { assert.equal(C.parseAmount('abc').ok, false); assert.equal(C.parseAmount('12a').ok, false); });

console.log('Tasa de estadística (Decreto 1140/2024)');
const te = cif => C.teAmount(cif, RULES);
test('CIF 5.000 → 150 (3 %, debajo del tope de 180)', () => near(te(5000).amount, 150));
test('CIF 9.000 → 180 (tope del tramo hasta 10.000)', () => { near(te(9000).amount, 180); assert.equal(te(9000).capped, true); });
test('CIF 10.000 exacto → 180 (tramo «hasta 10.000 inclusive»)', () => near(te(10000).amount, 180));
test('CIF 10.000,01 → 300,0003 (pasa al tramo con tope 3.000)', () => near(te(10000.01).amount, 300.0003));
test('CIF 100.000 → 3.000 (3 % igual al tope)', () => near(te(100000).amount, 3000));
test('CIF 200.000 → 6.000', () => near(te(200000).amount, 6000));
test('CIF 6.000.000 → 150.000 (tope máximo)', () => near(te(6000000).amount, 150000));

console.log('Importación: caso base (guía «Cómo calcular el costo de importar»)');
const A = imp();
test('valor CIF = 11.260', () => near(A.cif, 11260));
test('derecho 16 % = 1.801,60', () => near(A.diAmount, 1801.6));
test('tasa de estadística = 337,80', () => near(A.te.amount, 337.8));
test('base imponible = 13.399,40', () => near(A.base, 13399.4));
test('IVA 21 % = 2.813,874', () => near(A.iva, 2813.874));
test('percepción IVA 20 % = 2.679,88', () => near(A.piva, 2679.88));
test('percepción Ganancias 6 % = 803,964', () => near(A.pgan, 803.964));
test('percepción IIBB 2,5 % = 334,985', () => near(A.piibb, 334.985));
test('tributos = 8.772,103 y desembolso = 20.032,103', () => { near(A.tributos, 8772.103); near(A.desembolso, 20032.103); });
test('costo económico (inscripto) = 13.399,40', () => near(A.costo, 13399.4));

console.log('Importación: Incoterms');
test('CIF: no suma flete ni seguro aunque estén cargados', () => near(imp({ inco: 'CIF', precio: '11260' }).cif, 11260));
test('CFR: suma solo el seguro', () => near(imp({ inco: 'CFR', precio: '11200' }).cif, 11260));
test('EXW: suma gastos en origen, flete y seguro', () => near(imp({ inco: 'EXW', precio: '9500', origen: '500' }).cif, 11260));
test('FOB: ignora gastos en origen', () => near(imp({ origen: '500' }).cif, 11260));
test('EXW: el FOB intermedio es precio + gastos en origen', () => near(imp({ inco: 'EXW', precio: '9500', origen: '500' }).fob, 10000));

console.log('Importación: origen y exenciones');
const M = imp({ origin: 'mercosur', di: '' });
test('Mercosur: derecho 0 y tasa de estadística exenta', () => { near(M.diAmount, 0); near(M.te.amount, 0); assert.match(M.teExemptWhy, /Mercosur/); });
test('Mercosur: advierte que hace falta certificado de origen', () => assert.ok(M.warnings.some(w => /certificado de origen/.test(w))));
test('Mercosur con producto excluido: exige el derecho', () => assert.ok(imp({ origin: 'mercosur', mercoExcluded: true, di: '' }).errors.di));
test('Acuerdo preferencial: la tasa se cobra salvo que el acuerdo la exima', () => {
  near(imp({ origin: 'acuerdo', di: '5' }).te.amount, 337.8);
  near(imp({ origin: 'acuerdo', di: '5', acuerdoTeExento: true }).te.amount, 0);
});
test('Extrazona sin derecho cargado → no calcula (no asume 0 %)', () => { const r = imp({ di: '' }); assert.equal(r.ok, false); assert.ok(r.errors.di); });

console.log('Importación: situación fiscal');
const U = imp({ destino: 'uso' });
test('Bien de uso: sin percepciones de IVA ni de Ganancias', () => { near(U.piva, 0); near(U.pgan, 0); near(U.piibb, 334.985); });
const P = imp({ situacion: 'particular' });
test('Particular: sin percepción de IVA ni IIBB; Ganancias 11 %', () => { near(P.piva, 0); near(P.piibb, 0); near(P.pgan, 13399.4 * 0.11); });
test('Particular: costo = desembolso (nada se recupera)', () => near(P.costo, P.desembolso));
const Mo = imp({ situacion: 'mono' });
test('Monotributista: IVA y percepciones son costo', () => near(Mo.costo, Mo.desembolso));
test('IVA 10,5 % → percepción de IVA 10 %', () => assert.equal(imp({ iva: '10.5' }).rates.piva, 10));
test('IVA 0 % → sin percepción de IVA', () => near(imp({ iva: '0' }).piva, 0));
test('Exclusión de percepciones (certificado o RG 5490)', () => { const r = imp({ exclIva: true, exclGan: true }); near(r.piva, 0); near(r.pgan, 0); });
test('Hay 4 escenarios y uno marcado como actual', () => { assert.equal(A.scenarios.length, 4); assert.equal(A.scenarios.filter(s => s.current).length, 1); });

console.log('Importación: cada dato cambia solo lo que depende de él');
test('Cambiar el despachante solo cambia gastos, desembolso y costo', () => {
  const r = imp({ despachante: '500' });
  ['cif', 'diAmount', 'base', 'iva', 'piva', 'pgan', 'piibb', 'tributos'].forEach(k => near(r[k], A[k], k));
  near(r.gastos, 500); near(r.desembolso, A.desembolso + 500); near(r.costo, A.costo + 500);
});
test('Cambiar IIBB no cambia el costo de un inscripto', () => { const r = imp({ piibb: '1' }); near(r.costo, A.costo); assert.ok(r.desembolso < A.desembolso); });
test('Cambiar la situación fiscal no cambia CIF, derecho, tasa ni base', () => {
  ['mono', 'particular'].forEach(s => { const r = imp({ situacion: s }); ['cif', 'diAmount', 'base'].forEach(k => near(r[k], A[k], k)); near(r.te.amount, A.te.amount); });
});

console.log('Importación: validaciones y avisos');
test('Precio 0 o vacío → error', () => { assert.ok(imp({ precio: '0' }).errors.precio); assert.ok(imp({ precio: '' }).errors.precio); });
test('Derecho 150 % → error', () => assert.ok(imp({ di: '150' }).errors.di));
test('Flete negativo → error', () => assert.ok(imp({ flete: '-10' }).errors.flete));
test('Tipo de cambio 0 → error', () => assert.ok(imp({ tc: '0' }).errors.tc));
test('Seguro 0 → aviso', () => assert.ok(imp({ seguro: '0' }).warnings.some(w => /seguro/.test(w))));
test('Después del 31/12/2027 avisa que la tasa debe verificarse', () => {
  const r = C.computeImport(base(), RULES, { today: '2028-01-02' });
  assert.ok(r.warnings.some(w => /tasa de estadística/.test(w)));
});

console.log('Exportación');
const ex = o => C.computeExport(Object.assign({ fob: '20000', dex: '5', regimen: 'ninguno', reintEleg: 'no', reint: '', insTemp: '', insOtros: '', comis: '' }, o), RULES);
test('Derecho 5 % sobre FOB 20.000 = 1.000; neto 19.000', () => { const r = ex(); near(r.dexAmount, 1000); near(r.neto, 19000); });
test('Sin importación temporaria, los insumos no bajan la base del derecho', () => { const r = ex({ insTemp: '5000', insOtros: '3000' }); near(r.baseDex, 20000); near(r.dexAmount, 1000); });
test('Con importación temporaria: base 15.000, derecho 750', () => { const r = ex({ regimen: 'temporaria', insTemp: '5000' }); near(r.baseDex, 15000); near(r.dexAmount, 750); });
test('Reintegro 3 %: base FOB − insumos − comisiones = 12.500 → 375; neto 19.125', () => {
  const r = ex({ regimen: 'temporaria', insTemp: '5000', insOtros: '2000', comis: '500', reintEleg: 'si', reint: '3' });
  near(r.baseReint, 12500); near(r.reintAmount, 375); near(r.neto, 20000 - 750 - 500 + 375);
});
test('Reintegro sin confirmar: no se suma y avisa', () => { const r = ex({ reintEleg: 'nose', reint: '3' }); near(r.reintApplied, 0); near(r.neto, 19000); assert.ok(r.warnings.length); });
test('Reintegro «no»: se ignora la alícuota cargada', () => near(ex({ reintEleg: 'no', reint: '3' }).neto, 19000));
test('Derecho vacío → error (no asume 0 %)', () => assert.ok(ex({ dex: '' }).errors.dex));
test('Insumos temporarios mayores que el FOB → error', () => assert.ok(ex({ regimen: 'temporaria', insTemp: '25000' }).errors.insTemp));
test('Gastos se restan del neto', () => near(ex({ despachante: '300', fleteint: '200' }).neto, 18500));

console.log(`\n${passed} pruebas correctas, ${failed} con error.`);
process.exit(failed ? 1 : 0);
