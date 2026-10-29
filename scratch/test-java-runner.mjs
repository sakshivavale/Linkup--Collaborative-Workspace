import { executeCode } from '../server/src/lib/piston';

async function test() {
  console.log('Testing Java runtime error handling...');
  const javaCode = `public class Main {
    public static void main(String[] args) {
        throw new RuntimeException("Division by zero demo");
    }
}`;

  try {
    const result = await executeCode({
      language: 'java',
      code: javaCode,
    });
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error during execution:', err);
  }
}

test();
