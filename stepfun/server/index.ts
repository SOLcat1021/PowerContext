import cors from "cors";
import express from "express";
import { SeekdbClient, FulltextIndexConfig, Schema, VectorIndexConfig } from "seekdb";

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.SEEKDB_PATH ?? "./.data/stepfun.db";
const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

const client = new SeekdbClient({ path: dbPath, database: "stepfun" });
let collectionPromise: ReturnType<typeof client.getCollection> | null = null;

async function collection() {
  if (!collectionPromise) {
    collectionPromise = client
      .getCollection({ name: "documents" })
      .catch(async () => client.createCollection({
        name: "documents",
        schema: new Schema({
          vectorIndex: new VectorIndexConfig({
            hnsw: { dimension: 384, distance: "cosine" },
            embeddingFunction: null,
          }),
          fulltextIndex: new FulltextIndexConfig("ik"),
        }),
      }));
  }
  return collectionPromise;
}

app.get("/api/health", async (_req, res) => {
  try {
    const current = await collection();
    res.json({ ok: true, collection: current.name, dbPath });
  } catch (error) {
    res.status(503).json({ ok: false, error: String(error) });
  }
});

app.post("/api/documents", async (req, res) => {
  const { id, text, title, embedding } = req.body as {
    id?: string; text?: string; title?: string; embedding?: number[];
  };
  if (!id || !text || !Array.isArray(embedding) || embedding.length !== 384) {
    return res.status(400).json({ error: "id, text and a 384-dimensional embedding are required" });
  }
  try {
    const current = await collection();
    await current.add({
      ids: [id],
      documents: [text],
      embeddings: [embedding],
      metadatas: [{ title: title ?? "未命名文档", importedAt: new Date().toISOString() }],
    });
    res.status(201).json({ ok: true, id });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/search", async (req, res) => {
  const { query, embedding, limit = 8 } = req.body as {
    query?: string; embedding?: number[]; limit?: number;
  };
  if (!query || !Array.isArray(embedding) || embedding.length !== 384) {
    return res.status(400).json({ error: "query and a 384-dimensional embedding are required" });
  }
  try {
    const current = await collection();
    const result = await current.hybridSearch({
      query: { whereDocument: { $contains: query } },
      knn: { queryEmbeddings: [embedding] },
      nResults: Math.max(1, Math.min(20, limit)),
    });
    res.json({
      ids: result.ids?.[0] ?? [],
      documents: result.documents?.[0] ?? [],
      metadatas: result.metadatas?.[0] ?? [],
      distances: result.distances?.[0] ?? [],
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.listen(port, () => console.log(`StepFun API listening on http://localhost:${port}`));
