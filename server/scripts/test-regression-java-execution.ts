import assert from 'assert';
import { executeCode, resolveSourceFileName } from '../src/lib/piston';

/**
 * Regression Test: Multi-Language Code Execution & Java Runtime Suite
 * Verifies:
 * 1. Java class name resolution (public class, class, public final class).
 * 2. Execution of Java "Hello, World!".
 * 3. Java compilation error capture and non-zero exit code reporting.
 * 4. Java runtime exception capture and non-zero exit code reporting.
 * 5. Java standard input handling via Scanner.
 * 6. Python and JavaScript execution parity.
 */

async function run() {
  console.log('\n--- Running Regression Test: Java & Multi-Language Code Execution ---');
  let passed = 0;

  // 1. Source file name resolution
  assert.strictEqual(
    resolveSourceFileName('java', 'public class Main { public static void main(String[] args) {} }'),
    'Main.java'
  );
  assert.strictEqual(
    resolveSourceFileName('java', 'class Solution { public static void main(String[] args) {} }'),
    'Main.java'
  );
  assert.strictEqual(
    resolveSourceFileName('java', 'public final class QuickSort { public static void main(String[] args) {} }'),
    'QuickSort.java'
  );
  assert.strictEqual(
    resolveSourceFileName('java', '// No class definition\nint x = 1;'),
    'Main.java'
  );
  console.log('✓ PASS: Java class name resolution accurately determines file name');
  passed += 4;

  // 2. Java "Hello, World!" Execution
  console.log('Testing Java "Hello, World!"...');
  const javaHelloWorld = `
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
`;
  const helloResult = await executeCode({
    language: 'java',
    code: javaHelloWorld,
  });

  assert.strictEqual(helloResult.exitCode, 0, `Expected exitCode 0, got ${helloResult.exitCode}`);
  assert.strictEqual(helloResult.stdout.trim(), 'Hello, World!', `Expected "Hello, World!", got "${helloResult.stdout}"`);
  assert.strictEqual(helloResult.timedOut, false, 'Execution should not time out');
  console.log(`✓ PASS: Java Hello, World! executed successfully in ${helloResult.timeMs}ms (exitCode: 0)`);
  passed += 3;

  // 3. Java Compilation Syntax Error
  console.log('Testing Java compilation syntax error...');
  const javaSyntaxError = `
public class Main {
    public static void main(String[] args) {
        System.out.println("Missing semicolon")
    }
}
`;
  const syntaxErrResult = await executeCode({
    language: 'java',
    code: javaSyntaxError,
  });

  assert.notStrictEqual(syntaxErrResult.exitCode, 0, 'Exit code must be non-zero for compilation failure');
  const hasErrorIndicator =
    syntaxErrResult.stderr.toLowerCase().includes('error') ||
    syntaxErrResult.stderr.toLowerCase().includes('expected') ||
    syntaxErrResult.stderr.toLowerCase().includes('main.java');
  assert.strictEqual(hasErrorIndicator, true, `Stderr should contain compiler error info: ${syntaxErrResult.stderr}`);
  console.log('✓ PASS: Java compilation errors correctly captured in stderr with non-zero exit code');
  passed += 2;

  // 4. Java Runtime Exception
  console.log('Testing Java runtime exception...');
  const javaException = `
public class Main {
    public static void main(String[] args) {
        throw new RuntimeException("LinkupCustomExceptionThrown");
    }
}
`;
  const exceptionResult = await executeCode({
    language: 'java',
    code: javaException,
  });

  assert.notStrictEqual(exceptionResult.exitCode, 0, 'Exit code must be non-zero for runtime exception');
  assert.strictEqual(
    exceptionResult.stderr.includes('LinkupCustomExceptionThrown'),
    true,
    `Stderr should contain exception message: ${exceptionResult.stderr}`
  );
  console.log('✓ PASS: Java runtime exceptions cleanly captured and reported');
  passed += 2;

  // 5. Java Standard Input
  console.log('Testing Java standard input handling...');
  const javaStdin = `
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        if (scanner.hasNextLine()) {
            System.out.println("Received: " + scanner.nextLine());
        }
    }
}
`;
  const stdinResult = await executeCode({
    language: 'java',
    code: javaStdin,
    stdin: 'Collaborative Workspace\n',
  });

  assert.strictEqual(stdinResult.exitCode, 0, `Expected exitCode 0, got ${stdinResult.exitCode}`);
  assert.strictEqual(
    stdinResult.stdout.trim(),
    'Received: Collaborative Workspace',
    `Expected Received input, got "${stdinResult.stdout}"`
  );
  console.log('✓ PASS: Java stdin stream successfully passed and read');
  passed += 2;

  // 6. Python Execution Parity
  console.log('Testing Python parity...');
  const pyResult = await executeCode({
    language: 'python',
    code: 'print("Python Parity OK")',
  });
  assert.strictEqual(pyResult.exitCode, 0);
  assert.strictEqual(pyResult.stdout.trim(), 'Python Parity OK');
  console.log('✓ PASS: Python execution working properly');
  passed += 2;

  // 7. JavaScript Execution Parity
  console.log('Testing JavaScript parity...');
  const jsResult = await executeCode({
    language: 'javascript',
    code: 'console.log("JavaScript Parity OK");',
  });
  assert.strictEqual(jsResult.exitCode, 0);
  assert.strictEqual(jsResult.stdout.trim(), 'JavaScript Parity OK');
  console.log('✓ PASS: JavaScript execution working properly');
  passed += 2;

  console.log(`\nAll ${passed} code execution regression assertions PASSED!\n`);
}

run().catch((err) => {
  console.error('Java execution regression test failed:', err);
  process.exit(1);
});
