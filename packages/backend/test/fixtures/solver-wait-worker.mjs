process.once('message', () => {
  process.send?.({ type: 'progress', data: { stage: 'waiting', percent: 10, message: 'waiting' } });
  // Intentionally remain alive until the parent cancels this worker.
  setInterval(() => {}, 1_000);
});
