import getPDFs from './getPDFs';


(async () => {
  // npx ts-node src/test.ts
  await getPDFs().then(() => {
    console.log("ok");
    // It is optional - if comment out is, node.js get same result
    process.exit(0); 
}).catch(error => {
    console.error(error);
    process.exit(1);
});
})();