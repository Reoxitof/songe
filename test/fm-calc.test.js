'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calcResult, normalizeTentative } = require('../lib/fm-calc');

describe('calcResult', () => {
  it('calcule bénéfice, coût total et marge', () => {
    const r = calcResult({
      prixAchat: 100,
      coutCraft: 50,
      prixVente: 300,
      runes: [
        { quantite: 2, prixUnitaire: 25 },
        { quantite: 1, prixUnitaire: 10 },
      ],
    });
    assert.equal(r.coutTotal, 210);
    assert.equal(r.benefice, 90);
    assert.equal(r.marge, 42.9);
  });

  it('gère l’absence de runes et un coût nul', () => {
    const r = calcResult({ prixAchat: 0, coutCraft: 0, prixVente: 0 });
    assert.equal(r.coutTotal, 0);
    assert.equal(r.benefice, 0);
    assert.equal(r.marge, 0);
  });
});

describe('normalizeTentative', () => {
  it('accepte les statuts connus', () => {
    assert.equal(normalizeTentative('succes'), 'succes');
    assert.equal(normalizeTentative('echec'), 'echec');
    assert.equal(normalizeTentative('inconnu'), 'inconnu');
  });

  it('retombe sur inconnu sinon', () => {
    assert.equal(normalizeTentative('ok'), 'inconnu');
    assert.equal(normalizeTentative(undefined), 'inconnu');
  });
});
