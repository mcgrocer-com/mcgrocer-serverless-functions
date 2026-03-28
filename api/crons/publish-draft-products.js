
/**
 * Cron handler — triggers the batch worker endpoint which self-chains
 * until all qualifying draft products are published.
 */
async function handler(req, res) {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Cron triggered: Publish Draft Products`);

  try {
    const host = req.headers.host || process.env.VERCEL_URL;
    const baseUrl = `https://${host}`;
    const workerUrl = `${baseUrl}/api/publish-batch?chain=0`;

    console.log(`Host header: ${req.headers.host}`);
    console.log(`VERCEL_URL: ${process.env.VERCEL_URL}`);
    console.log(`Triggering worker: ${workerUrl}`);

    const workerRes = await fetch(workerUrl);
    const responseText = await workerRes.text();

    console.log(`Worker responded: HTTP ${workerRes.status}`);
    console.log(`Response body (first 200 chars): ${responseText.substring(0, 200)}`);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { rawResponse: responseText.substring(0, 500) };
    }

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
