import getPDFs from './getPDFs';


(async () => {
  // npx ts-node src/test.ts
  await getPDFs();
  console.log('完了');
})();