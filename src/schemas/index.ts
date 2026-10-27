// =====================================================
// Schemas de Zod para cada tool del MCP server.
// Cumplen dos funciones:
//   1) Validar los datos ANTES de llamar a la API de GitHub.
//   2) Describir cada parámetro para que el LLM sepa qué enviar.
// =====================================================

import { z } from "zod";
import { ValidationError } from "../errors/index.js";

// -----------------------------------------------------
// Campos reutilizables
// -----------------------------------------------------

/** Usuario u organización dueña del repo (opcional: por defecto, el dueño del token). */
const ownerField = z
  .string()
  .min(1, "El owner no puede estar vacío.")
  .max(39, "El usuario u organización de GitHub tiene como máximo 39 caracteres.")
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/,
    "El owner solo puede tener letras, números y guiones simples, y no puede empezar ni terminar con guion."
  )
  .optional()
  .describe(
    "Usuario u organización dueña del repositorio. Si se omite, se usa el usuario autenticado (dueño del token)."
  );

/** Nombre de repositorio según las reglas de GitHub. */
const repoNameField = z
  .string({ required_error: "El nombre del repositorio es obligatorio." })
  .min(3, "El nombre del repositorio debe tener al menos 3 caracteres.")
  .max(100, "El nombre del repositorio puede tener como máximo 100 caracteres.")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "El nombre del repositorio solo puede contener letras, números, guiones (-), guiones bajos (_) y puntos, y debe empezar con letra o número. No se permiten espacios."
  )
  .refine(
    (name) => !name.toLowerCase().endsWith(".git"),
    "El nombre del repositorio no puede terminar en '.git'."
  )
  .describe("Nombre del repositorio, sin el owner. Ejemplo: 'mi-proyecto'.");

/** Número de issue: entero positivo. */
const issueNumberField = z
  .number({
    required_error: "El número de issue es obligatorio.",
    invalid_type_error: "El número de issue debe ser un número (ej: 3).",
  })
  .int("El número de issue debe ser un número entero.")
  .positive("El número de issue debe ser mayor a 0.")
  .describe("Número del issue tal como aparece en GitHub, sin el '#'. Ejemplo: 3.");

/** Nombre de branch según reglas básicas de Git. */
const branchField = z
  .string()
  .min(1, "El nombre de la branch no puede estar vacío.")
  .max(255, "El nombre de la branch es demasiado largo (máximo 255 caracteres).")
  .regex(
    /^[A-Za-z0-9._/-]+$/,
    "El nombre de la branch solo puede tener letras, números, '.', '_', '-' y '/'. No se permiten espacios."
  )
  .refine(
    (b) =>
      !b.includes("..") &&
      !b.startsWith("/") &&
      !b.endsWith("/") &&
      !b.endsWith(".lock"),
    "El nombre de la branch no puede contener '..', empezar o terminar con '/', ni terminar en '.lock'."
  );

/** Cantidad de resultados por página (GitHub permite hasta 100). */
const perPageField = z
  .number()
  .int("La cantidad debe ser un número entero.")
  .min(1, "La cantidad mínima de resultados es 1.")
  .max(100, "GitHub permite como máximo 100 resultados por página.")
  .default(30)
  .describe("Cantidad máxima de resultados a devolver (1 a 100). Por defecto 30.");

// -----------------------------------------------------
// 1) create_repository
// -----------------------------------------------------
export const createRepositoryShape = {
  name: repoNameField,
  description: z
    .string()
    .max(350, "La descripción puede tener como máximo 350 caracteres.")
    .optional()
    .describe("Descripción corta del repositorio."),
  private: z
    .boolean()
    .default(false)
    .describe("true para crear el repositorio como privado. Por defecto es público."),
  autoInit: z
    .boolean()
    .default(true)
    .describe(
      "Si es true, crea el repo con un README inicial. Recomendado: permite hacer commits inmediatamente."
    ),
};
export const createRepositorySchema = z.object(createRepositoryShape);
export type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;

// -----------------------------------------------------
// 2) create_issue
// -----------------------------------------------------
export const createIssueShape = {
  owner: ownerField,
  repo: repoNameField,
  title: z
    .string({ required_error: "El título del issue es obligatorio." })
    .min(1, "El título del issue no puede estar vacío.")
    .max(256, "El título del issue puede tener como máximo 256 caracteres.")
    .describe("Título del issue: resumen corto del problema o tarea."),
  body: z
    .string()
    .max(65536, "El cuerpo del issue es demasiado largo.")
    .optional()
    .describe("Descripción detallada del issue. Acepta Markdown."),
  labels: z
    .array(z.string().min(1, "Una etiqueta no puede estar vacía."))
    .optional()
    .describe("Lista de etiquetas existentes a aplicar. Ejemplo: ['bug', 'urgente']."),
};
export const createIssueSchema = z.object(createIssueShape);
export type CreateIssueInput = z.infer<typeof createIssueSchema>;

// -----------------------------------------------------
// 3) list_repositories
// -----------------------------------------------------
export const listRepositoriesShape = {
  visibility: z
    .enum(["all", "public", "private"], {
      errorMap: () => ({ message: "La visibilidad debe ser 'all', 'public' o 'private'." }),
    })
    .default("all")
    .describe("Filtrar por visibilidad: 'all', 'public' o 'private'."),
  sort: z
    .enum(["created", "updated", "pushed", "full_name"], {
      errorMap: () => ({
        message: "El orden debe ser 'created', 'updated', 'pushed' o 'full_name'.",
      }),
    })
    .default("updated")
    .describe("Criterio de orden. Por defecto 'updated' (los más recientes primero)."),
  perPage: perPageField,
};
export const listRepositoriesSchema = z.object(listRepositoriesShape);
export type ListRepositoriesInput = z.infer<typeof listRepositoriesSchema>;

// -----------------------------------------------------
// 4) create_commit
// -----------------------------------------------------
export const createCommitShape = {
  owner: ownerField,
  repo: repoNameField,
  path: z
    .string({ required_error: "La ruta del archivo es obligatoria." })
    .min(1, "La ruta del archivo no puede estar vacía.")
    .max(4096, "La ruta del archivo es demasiado larga.")
    .refine(
      (p) => !p.startsWith("/") && !p.includes("..") && !p.includes("\\"),
      "La ruta debe ser relativa a la raíz del repo (ej: 'docs/notas.md'), sin '/' inicial, sin '..' y usando '/' como separador."
    )
    .describe("Ruta del archivo dentro del repo. Ejemplo: 'README.md' o 'src/index.js'."),
  content: z
    .string({ required_error: "El contenido del archivo es obligatorio." })
    .describe("Contenido completo del archivo en texto plano. Si el archivo existe, se reemplaza."),
  message: z
    .string({ required_error: "El mensaje del commit es obligatorio." })
    .min(1, "El mensaje del commit no puede estar vacío.")
    .max(500, "El mensaje del commit es demasiado largo (máximo 500 caracteres).")
    .describe("Mensaje del commit. Ejemplo: 'docs: agrega guía de instalación'."),
  branch: branchField
    .optional()
    .describe("Branch donde hacer el commit. Si se omite, se usa la branch principal del repo."),
};
export const createCommitSchema = z.object(createCommitShape);
export type CreateCommitInput = z.infer<typeof createCommitSchema>;

// -----------------------------------------------------
// 5) list_issues
// -----------------------------------------------------
export const listIssuesShape = {
  owner: ownerField,
  repo: repoNameField,
  state: z
    .enum(["open", "closed", "all"], {
      errorMap: () => ({ message: "El estado debe ser 'open', 'closed' o 'all'." }),
    })
    .default("open")
    .describe("Estado de los issues a listar. Por defecto 'open' (abiertos)."),
  perPage: perPageField,
};
export const listIssuesSchema = z.object(listIssuesShape);
export type ListIssuesInput = z.infer<typeof listIssuesSchema>;

// =====================================================
// EXTRA CREDIT
// =====================================================

// 6) create_branch
export const createBranchShape = {
  owner: ownerField,
  repo: repoNameField,
  branch: branchField.describe("Nombre de la nueva branch. Ejemplo: 'feature/login'."),
  fromBranch: branchField
    .optional()
    .describe("Branch desde la cual crear la nueva. Si se omite, se usa la branch principal."),
};
export const createBranchSchema = z.object(createBranchShape);
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

// 7) close_issue
export const closeIssueShape = {
  owner: ownerField,
  repo: repoNameField,
  issueNumber: issueNumberField,
  comment: z
    .string()
    .max(65536, "El comentario es demasiado largo.")
    .optional()
    .describe("Comentario opcional para dejar antes de cerrar (ej: el motivo del cierre)."),
};
export const closeIssueSchema = z.object(closeIssueShape);
export type CloseIssueInput = z.infer<typeof closeIssueSchema>;

// 8) add_comment_to_issue
export const addCommentShape = {
  owner: ownerField,
  repo: repoNameField,
  issueNumber: issueNumberField,
  body: z
    .string({ required_error: "El texto del comentario es obligatorio." })
    .min(1, "El comentario no puede estar vacío.")
    .max(65536, "El comentario es demasiado largo.")
    .describe("Texto del comentario. Acepta Markdown."),
};
export const addCommentSchema = z.object(addCommentShape);
export type AddCommentInput = z.infer<typeof addCommentSchema>;

// 9) list_commits
export const listCommitsShape = {
  owner: ownerField,
  repo: repoNameField,
  branch: branchField
    .optional()
    .describe("Branch de la cual listar commits. Si se omite, se usa la principal."),
  perPage: perPageField.describe("Cantidad de commits a devolver (1 a 100). Por defecto 30."),
};
export const listCommitsSchema = z.object(listCommitsShape);
export type ListCommitsInput = z.infer<typeof listCommitsSchema>;

// -----------------------------------------------------
// Helper de validación
// -----------------------------------------------------

/**
 * Valida un input contra un schema.
 * Si falla, lanza un ValidationError con TODOS los problemas
 * explicados en lenguaje natural.
 */
export function validateInput<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown
): z.output<T> {
  const result = schema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const field = issue.path.join(".") || "datos";
        return `${field}: ${issue.message}`;
      })
      .join(" | ");
    throw new ValidationError(`Los datos enviados no son válidos. ${details}`);
  }

  return result.data;
}