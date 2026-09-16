'use strict';

function calcResult(entry) {
  const achat = Number(entry.prixAchat || 0);
  const craft = Number(entry.coutCraft || 0);
  const vente = Number(entry.prixVente || 0);
  const coutRunes = (entry.runes || []).reduce((acc, r) => {
    return acc + (Number(r.quantite || 0) * Number(r.prixUnitaire || 0));
  }, 0);

  const coutTotal = achat + craft + coutRunes;
  const benefice  = vente - coutTotal;
  const marge     = coutTotal > 0 ? Math.round((benefice / coutTotal) * 1000) / 10 : 0;

  return { coutTotal, benefice, marge };
}

function normalizeTentative(statut) {
  return ['succes', 'echec', 'inconnu'].includes(statut) ? statut : 'inconnu';
}

module.exports = { calcResult, normalizeTentative };
