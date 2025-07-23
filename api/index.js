const path = require('path');

const serverDistPath = path.join(process.cwd(), 'dist/exam-score/server/server.mjs');

export default import(serverDistPath).then(module => module.app);