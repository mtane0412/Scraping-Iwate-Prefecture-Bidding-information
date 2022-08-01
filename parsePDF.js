const fs = require('fs');
const pdf = require('pdf-parse');
 
let dataBuffer = fs.readFileSync(`data/2022-4-1008-00039_盛岡土木部管内土砂災害防止法基礎調査区域調書更新業務委託/36-00-01+入札公告.pdf`);
 
pdf(dataBuffer).then(function(data) {
 
    // number of pages
    console.log(data.numpages);
    // number of rendered pages
    console.log(data.numrender);
    // PDF info
    console.log(data.info);
    // PDF metadata
    console.log(data.metadata); 
    // PDF.js version
    // check https://mozilla.github.io/pdf.js/getting_started/
    console.log(data.version);
    // PDF text
    console.log(data.text); 
        
});