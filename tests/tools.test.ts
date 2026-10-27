// =====================================================
// Tests de validación de schemas (Zod) y del helper de tools.
// Verifican que inputs válidos pasan y que los inválidos
// se rechazan con mensajes claros, SIN llamar a GitHub.
// =====================================================

import { describe, it, expect, vi } from "vitest";
import {
  createRepositorySchema,
  createIssueSchema,
  createCommitSchema,
  listIssuesSchema,
  closeIssueSchema,
  createBranchSchema,
  validateInput,
} from "../src/schemas/index.js";
import { ValidationError } from "../src/errors/index.js";
import { executeTool } from "../src/tools/helpers.js";

/** Devuelve el primer mensaje de error de Zod (o undefined si es válido). */
function firstError(schema: { safeParse: (v: unknown) => any }, input: unknown) {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0].message;
}

describe("Schema: create_repository", () => {
  it("acepta un nombre válido y aplica los valores por defecto", () => {
    const data = validateInput(createRepositorySchema, { name: "mi-proyecto" });
    expect(data).toEqual({ name: "mi-proyecto", private: false, autoInit: true });
  });

  it("rechaza nombres de menos de 3 caracteres", () => {
    expect(firstError(createRepositorySchema, { name: "ab" })).toBe(
      "El nombre del repositorio debe tener al menos 3 caracteres."
    );
  });

  it("rechaza nombres de más de 100 caracteres", () => {
    expect(firstError(createRepositorySchema, { name: "a".repeat(101) })).toContain(
      "como máximo 100 caracteres"
    );
  });

  it("rechaza nombres con espacios", () => {
    expect(firstError(createRepositorySchema, { name: "mi proyecto" })).toContain(
      "No se permiten espacios"
    );
  });

  it("rechaza nombres que terminan en .git", () => {
    expect(firstError(createRepositorySchema, { name: "proyecto.git" })).toContain(".git");
  });
});

describe("Schema: create_issue", () => {
  it("acepta un issue con repo y título", () => {
    expect(
      createIssueSchema.safeParse({ repo: "mi-proyecto", title: "Bug en login" }).success
    ).toBe(true);
  });

  it("rechaza un título vacío", () => {
    expect(firstError(createIssueSchema, { repo: "mi-proyecto", title: "" })).toBe(
      "El título del issue no puede estar vacío."
    );
  });
});

describe("Schema: create_commit", () => {
  it("rechaza rutas con '..' o que empiezan con '/'", () => {
    const base = { repo: "mi-proyecto", content: "hola", message: "test" };
    expect(createCommitSchema.safeParse({ ...base, path: "../secreto.txt" }).success).toBe(false);
    expect(createCommitSchema.safeParse({ ...base, path: "/README.md" }).success).toBe(false);
    expect(createCommitSchema.safeParse({ ...base, path: "docs/notas.md" }).success).toBe(true);
  });
});

describe("Schema: list_issues", () => {
  it("usa 'open' y 30 resultados por defecto, y rechaza más de 100", () => {
    const data = validateInput(listIssuesSchema, { repo: "mi-proyecto" });
    expect(data.state).toBe("open");
    expect(data.perPage).toBe(30);
    expect(listIssuesSchema.safeParse({ repo: "mi-proyecto", perPage: 101 }).success).toBe(false);
  });
});

describe("Schemas extra", () => {
  it("close_issue rechaza números de issue negativos o decimales", () => {
    const base = { repo: "mi-proyecto" };
    expect(closeIssueSchema.safeParse({ ...base, issueNumber: -1 }).success).toBe(false);
    expect(closeIssueSchema.safeParse({ ...base, issueNumber: 1.5 }).success).toBe(false);
    expect(closeIssueSchema.safeParse({ ...base, issueNumber: 3 }).success).toBe(true);
  });

  it("create_branch rechaza nombres de branch con espacios o '..'", () => {
    const base = { repo: "mi-proyecto" };
    expect(createBranchSchema.safeParse({ ...base, branch: "mi rama" }).success).toBe(false);
    expect(createBranchSchema.safeParse({ ...base, branch: "feature/..x" }).success).toBe(false);
    expect(createBranchSchema.safeParse({ ...base, branch: "feature/login" }).success).toBe(true);
  });
});

describe("validateInput", () => {
  it("lanza ValidationError listando TODOS los campos inválidos", () => {
    try {
      validateInput(createIssueSchema, { repo: "ab", title: "" });
      expect.fail("Debería haber lanzado un error");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const message = (error as Error).message;
      expect(message).toContain("repo:");
      expect(message).toContain("title:");
    }
  });
});

describe("executeTool (helper común de las tools)", () => {
  it("si la validación falla devuelve isError y NO ejecuta la acción", async () => {
    const action = vi.fn();
    const result = await executeTool("create_issue", createIssueSchema, { repo: "x" }, action);

    expect(result.isError).toBe(true);
    expect(action).not.toHaveBeenCalled();
  });

  it("si todo sale bien devuelve el resumen y los datos en texto", async () => {
    const result = await executeTool(
      "create_issue",
      createIssueSchema,
      { repo: "mi-proyecto", title: "Hola" },
      async () => ({ summary: "Issue creado", data: { number: 1 } })
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Issue creado");
    expect(text).toContain('"number": 1');
  });
});