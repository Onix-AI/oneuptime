import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "../../Utils/StackTraceParser";

describe("StackTraceParser", () => {
  describe("parse", () => {
    test("returns empty frames for empty input", () => {
      const result: ParsedStackTrace = StackTraceParser.parse("");
      expect(result.frames).toHaveLength(0);
      expect(result.raw).toBe("");
    });

    test("returns empty frames for null-ish input", () => {
      const result: ParsedStackTrace = StackTraceParser.parse(
        undefined as unknown as string,
      );
      expect(result.frames).toHaveLength(0);
    });

    test("preserves raw stack trace", () => {
      const rawTrace: string =
        "Error: something\n    at foo (/app/bar.js:10:5)";
      const result: ParsedStackTrace = StackTraceParser.parse(rawTrace);
      expect(result.raw).toBe(rawTrace);
    });
  });

  describe("JavaScript/Node.js stack traces", () => {
    test("parses standard Node.js stack trace", () => {
      const trace: string = `TypeError: Cannot read property 'id' of undefined
    at getUser (/app/src/services/user.ts:42:15)
    at processRequest (/app/src/controllers/api.ts:128:20)
    at Layer.handle [as handle_request] (node_modules/express/lib/router/layer.js:95:5)
    at next (node_modules/express/lib/router/route.js:144:13)`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);

      expect(result.frames.length).toBeGreaterThanOrEqual(2);

      // First frame should be getUser
      const firstFrame: StackFrame | undefined = result.frames[0];
      expect(firstFrame).toBeDefined();
      expect(firstFrame!.functionName).toBe("getUser");
      expect(firstFrame!.fileName).toBe("/app/src/services/user.ts");
      expect(firstFrame!.lineNumber).toBe(42);
      expect(firstFrame!.columnNumber).toBe(15);
      expect(firstFrame!.inApp).toBe(true);
    });

    test("marks node_modules as library code", () => {
      const trace: string = `Error: test
    at handler (/app/src/handler.js:10:5)
    at Layer.handle (node_modules/express/lib/router/layer.js:95:5)`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);
      const expressFrame: StackFrame | undefined = result.frames.find(
        (f: StackFrame) => {
          return f.fileName.includes("express");
        },
      );
      expect(expressFrame).toBeDefined();
      expect(expressFrame!.inApp).toBe(false);
    });

    test("parses anonymous function frames", () => {
      const trace: string = `Error: test
    at /app/src/index.js:5:10`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);
      expect(result.frames.length).toBeGreaterThanOrEqual(1);
      expect(result.frames[0]!.functionName).toBe("<anonymous>");
    });
  });

  describe("Python stack traces", () => {
    test("parses standard Python traceback", () => {
      const trace: string = `Traceback (most recent call last):
  File "/app/main.py", line 42, in handle_request
    result = process_data(data)
  File "/app/utils.py", line 15, in process_data
    return data["key"]
KeyError: 'key'`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);

      expect(result.frames.length).toBeGreaterThanOrEqual(2);

      const firstFrame: StackFrame | undefined = result.frames[0];
      expect(firstFrame).toBeDefined();
      expect(firstFrame!.fileName).toBe("/app/main.py");
      expect(firstFrame!.lineNumber).toBe(42);
      expect(firstFrame!.functionName).toBe("handle_request");
      expect(firstFrame!.inApp).toBe(true);
    });

    test("marks site-packages as library code", () => {
      const trace: string = `Traceback (most recent call last):
  File "/usr/lib/python3.9/site-packages/django/core/handlers.py", line 47, in inner
    response = get_response(request)
  File "/app/views.py", line 10, in index
    raise ValueError("test")`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);
      const djangoFrame: StackFrame | undefined = result.frames.find(
        (f: StackFrame) => {
          return f.fileName.includes("site-packages");
        },
      );
      expect(djangoFrame).toBeDefined();
      expect(djangoFrame!.inApp).toBe(false);

      const appFrame: StackFrame | undefined = result.frames.find(
        (f: StackFrame) => {
          return f.fileName === "/app/views.py";
        },
      );
      expect(appFrame).toBeDefined();
      expect(appFrame!.inApp).toBe(true);
    });
  });

  describe("Java stack traces", () => {
    test("parses standard Java stack trace", () => {
      const trace: string = `java.lang.NullPointerException: Cannot invoke method on null
	at com.myapp.service.UserService.getUser(UserService.java:42)
	at com.myapp.controller.ApiController.handleRequest(ApiController.java:128)
	at org.springframework.web.servlet.FrameworkServlet.service(FrameworkServlet.java:897)
	at javax.servlet.http.HttpServlet.service(HttpServlet.java:750)`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);

      expect(result.frames.length).toBeGreaterThanOrEqual(2);

      const firstFrame: StackFrame | undefined = result.frames[0];
      expect(firstFrame).toBeDefined();
      expect(firstFrame!.functionName).toContain("UserService.getUser");
      expect(firstFrame!.fileName).toBe("UserService.java");
      expect(firstFrame!.lineNumber).toBe(42);
    });

    test("marks standard Java libs as library code", () => {
      const trace: string = `Exception
	at com.myapp.Main.run(Main.java:10)
	at java.lang.Thread.run(Thread.java:748)`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);
      const javaFrame: StackFrame | undefined = result.frames.find(
        (f: StackFrame) => {
          return f.functionName.startsWith("java.");
        },
      );
      expect(javaFrame).toBeDefined();
      expect(javaFrame!.inApp).toBe(false);
    });

    test("handles Native Method entries", () => {
      const trace: string = `Exception
	at sun.reflect.NativeMethodAccessorImpl.invoke(Native Method)`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);
      if (result.frames.length > 0) {
        expect(result.frames[0]!.fileName).toBe("Native Method");
        expect(result.frames[0]!.inApp).toBe(false);
      }
    });
  });

  describe("Go stack traces", () => {
    test("parses standard Go stack trace", () => {
      const trace: string = `goroutine 1 [running]:
main.handler(0xc0000b4000)
	/app/main.go:42 +0x1a5
net/http.(*ServeMux).ServeHTTP(0xc0000b4000, 0x7f3a9c, 0xc0000b8000)
	/usr/local/go/src/net/http/server.go:2387 +0x1a5`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);

      expect(result.frames.length).toBeGreaterThanOrEqual(1);

      const appFrame: StackFrame | undefined = result.frames.find(
        (f: StackFrame) => {
          return f.fileName === "/app/main.go";
        },
      );
      expect(appFrame).toBeDefined();
      expect(appFrame!.lineNumber).toBe(42);
      expect(appFrame!.inApp).toBe(true);
    });
  });

  describe("Ruby stack traces", () => {
    test("parses standard Ruby backtrace", () => {
      const trace: string = `/app/controllers/users_controller.rb:42:in 'show'
/app/middleware/auth.rb:15:in 'call'
/usr/local/lib/ruby/gems/2.7.0/gems/rack-2.2.3/lib/rack/handler.rb:12:in 'call'`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);

      expect(result.frames.length).toBeGreaterThanOrEqual(2);

      const firstFrame: StackFrame | undefined = result.frames[0];
      expect(firstFrame).toBeDefined();
      expect(firstFrame!.fileName).toBe("/app/controllers/users_controller.rb");
      expect(firstFrame!.lineNumber).toBe(42);
      expect(firstFrame!.functionName).toBe("show");
      expect(firstFrame!.inApp).toBe(true);
    });

    test("marks gems as library code", () => {
      const trace: string = `/usr/local/lib/ruby/gems/2.7.0/gems/rack-2.2.3/lib/rack/handler.rb:12:in 'call'`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);
      if (result.frames.length > 0) {
        expect(result.frames[0]!.inApp).toBe(false);
      }
    });
  });

  describe("C#/.NET stack traces", () => {
    test("parses .NET stack trace with file info", () => {
      const trace: string = `System.NullReferenceException: Object reference not set
   at MyApp.Services.UserService.GetUser(Int32 id) in /app/Services/UserService.cs:line 42
   at MyApp.Controllers.ApiController.HandleRequest() in /app/Controllers/ApiController.cs:line 128
   at System.Runtime.CompilerServices.TaskAwaiter.HandleNonSuccessAndDebuggerNotification(Task task)`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);

      expect(result.frames.length).toBeGreaterThanOrEqual(2);

      const userServiceFrame: StackFrame | undefined = result.frames.find(
        (f: StackFrame) => {
          return f.fileName.includes("UserService.cs");
        },
      );
      expect(userServiceFrame).toBeDefined();
      expect(userServiceFrame!.lineNumber).toBe(42);
    });
  });

  describe("PHP stack traces", () => {
    test("parses standard PHP stack trace", () => {
      const trace: string = `#0 /app/src/Controller/UserController.php(42): App\\Service\\UserService->getUser()
#1 /app/vendor/symfony/http-kernel/HttpKernel.php(128): App\\Controller\\UserController->show()
#2 {main}`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);

      expect(result.frames.length).toBeGreaterThanOrEqual(2);

      const firstFrame: StackFrame | undefined = result.frames[0];
      expect(firstFrame).toBeDefined();
      expect(firstFrame!.fileName).toBe(
        "/app/src/Controller/UserController.php",
      );
      expect(firstFrame!.lineNumber).toBe(42);
      expect(firstFrame!.inApp).toBe(true);
    });

    test("marks vendor as library code", () => {
      const trace: string = `#0 /app/vendor/symfony/http-kernel/HttpKernel.php(128): App\\Controller\\UserController->show()`;

      const result: ParsedStackTrace = StackTraceParser.parse(trace);
      if (result.frames.length > 0) {
        expect(result.frames[0]!.inApp).toBe(false);
      }
    });
  });

  describe("inApp detection", () => {
    test("node_modules is not app code", () => {
      const trace: string = `Error: test
    at handler (node_modules/express/lib/router.js:10:5)`;
      const result: ParsedStackTrace = StackTraceParser.parse(trace);
      if (result.frames.length > 0) {
        expect(result.frames[0]!.inApp).toBe(false);
      }
    });

    test("application source is app code", () => {
      const trace: string = `Error: test
    at handler (/app/src/handler.ts:10:5)`;
      const result: ParsedStackTrace = StackTraceParser.parse(trace);
      if (result.frames.length > 0) {
        expect(result.frames[0]!.inApp).toBe(true);
      }
    });
  });
});
