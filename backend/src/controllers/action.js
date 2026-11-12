const { asyncHandler, sendSuccess, metaOf } = require('../utils/http');

function action(fn, message = 'OK', status = 200) {
  return asyncHandler(async (req, res) => {
    const result = await fn(req, metaOf(req));
    if (result?.download) {
      res.setHeader('Content-Type', result.download.mime);
      res.setHeader('Content-Disposition', `attachment; filename="${result.download.filename}"`);
      return res.send(result.download.buffer);
    }
    return sendSuccess(res, {
      status: result?.status || status,
      message: result?.message || message,
      data: result?.data ?? null,
      meta: result?.meta,
    });
  });
}

module.exports = { action };
