
/**
 * Cron handler — triggers the batch worker endpoint which self-chains
 * until all qualifying draft products are published.
 */
async function handler(req, res) {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Cron triggered: Publish Draft Products`);

  try {
    const baseUrl = `https://${req.headers.host}`;
    const workerUrl = `${baseUrl}/api/publish-batch?chain=0`;

    console.log(`Triggering worker: ${workerUrl}`);
    const workerRes = await fetch(workerUrl);
    const data = await workerRes.json();

    console.log(`Worker responded: HTTP ${workerRes.status}`);

    return res.status(200).json({
      status: 'success',
      message: 'Batch publishing started',
      workerResponse: data,
      timestamp: startTime.toISOString(),
    });
  } catch (error) {
    console.error(`Cron trigger failed:`, error);

    return res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: startTime.toISOString(),
    });
  }
}

module.exports = handler;
