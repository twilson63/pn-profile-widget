const arweave = Arweave.init({
  host: "arweave.net",
  protocol: "https",
  port: 443,
});

export function getProfile(addr) {
  const query = `
  query {
    transactions(
      owners: ["${addr}"],
      tags: [
        { name: "Protocol", values: ["PermaProfile-v0.1"]}
      ]
    ) {
      edges {
        node {
          id
          owner {
            address
          },
          tags {
            name
            value
          }
        }
      }
    }
  }  
  `
  return arweave.api.post('graphql', { query })
    .then(({ data: { data: { transactions: { edges } } } }) => edges.map(e => e.node)[0])
    .then(record => arweave.api.get(record.id))
    .then(({ data }) => data)

}

