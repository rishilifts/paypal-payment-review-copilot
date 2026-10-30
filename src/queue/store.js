// JSON-file store for payment events + internal review flags.
// Flags are INTERNAL review aids only - they never touch the actual payment.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    try { this.data = JSON.parse(readFileSync(path, 'utf8')); }
    catch { this.data = { payments: [], reviews: [] }; }
    this.data.config ||= { markets: ['US', 'IN'], typical_max_amount: 500, currency: 'USD' };
  }
  save() { writeFileSync(this.path, JSON.stringify(this.data, null, 2)); }
  upsertPayment(p) {
    const i = this.data.payments.findIndex(x => x.id === p.id);
    if (i >= 0) this.data.payments[i] = { ...this.data.payments[i], ...p };
    else this.data.payments.push({ ...p, first_seen: new Date().toISOString() });
    this.save();
    return this.data.payments.find(x => x.id === p.id);
  }
  listPayments() { return [...this.data.payments].sort((a, b) => (b.first_seen || '').localeCompare(a.first_seen || '')); }
  getPayment(id) { return this.data.payments.find(x => x.id === id); }
  setReview(paymentId, review) {
    const i = this.data.reviews.findIndex(r => r.payment_id === paymentId);
    const rec = { payment_id: paymentId, ...review, updated_at: new Date().toISOString() };
    if (i >= 0) this.data.reviews[i] = rec; else this.data.reviews.push(rec);
    this.save();
    return rec;
  }
  getReview(paymentId) { return this.data.reviews.find(r => r.payment_id === paymentId); }
  setAiReview(paymentId, ai) {
    this.data.aiReviews ||= [];
    this.data.aiReviews = this.data.aiReviews.filter(r => r.payment_id !== paymentId);
    this.data.aiReviews.push({ payment_id: paymentId, ...ai });
    this.save();
  }
  getAiReview(paymentId) { return (this.data.aiReviews || []).find(r => r.payment_id === paymentId); }
  listReviews() { return this.data.reviews; }
  getConfig() { return this.data.config; }
  setConfig(c) { this.data.config = { ...this.data.config, ...c }; this.save(); return this.data.config; }
}
