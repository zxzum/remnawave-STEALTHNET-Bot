export function buildReferralAccrualNotification(data: {
  level: number;
  amount: number;
  balance: number;
  currency: string;
}): { subject: string; text: string; html: string } {
  const amount = `${data.amount.toFixed(2)} ${data.currency.toUpperCase()}`;
  const balance = `${data.balance.toFixed(2)} ${data.currency.toUpperCase()}`;
  return {
    subject: "Реферальное начисление — Лазейка ВПН",
    text: `💰 <b>Реферальное начисление</b>\n\nУровень: <b>${data.level}</b>\nНачислено: <b>${amount}</b>\nБаланс: <b>${balance}</b>`,
    html: `<h2>Реферальное начисление</h2><p>Уровень: <strong>${data.level}</strong></p><p>Начислено: <strong>${amount}</strong></p><p>Баланс: <strong>${balance}</strong></p>`,
  };
}
