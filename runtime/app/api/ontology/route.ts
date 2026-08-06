import { loadOntology } from "@/skills/ontology/catalog_loader_adapter";
import { loadOntologyCatalog } from "@/skills/ontology/catalog_loader";
import { loadDataMappingRegistry } from "@/skills/financial_data/data_mapping";
export const runtime="nodejs";
export async function GET(){
  const catalog = loadOntologyCatalog();
  const mappings = loadDataMappingRegistry();
  return Response.json({
    semantic_infrastructure: {
      schema_version: catalog.schema_version,
      ontology_fingerprint: catalog.fingerprint,
      model_versions: catalog.model_versions,
      counts: {
        object_types: catalog.object_types.size,
        relation_types: catalog.relation_types.size,
        rules: catalog.rules.size,
        scenario_types: catalog.scenario_types.size,
      },
      data_mapping_profiles: mappings.profiles.map((profile) => ({
        id: profile.id,
        version: profile.version,
        connector: profile.connector,
        target_types: profile.target_mappings.map((mapping) => mapping.target_type),
      })),
      data_mapping_coverage: {
        registered: mappings.profiles.filter((profile) => profile.status === "active").length,
        required: mappings.required_connectors.length,
        complete: mappings.profiles.filter((profile) => profile.status === "active").length === mappings.required_connectors.length,
      },
    },
    nodes: loadOntology(),
  });
}
