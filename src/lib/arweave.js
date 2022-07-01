import compose from 'ramda/src/compose'
import sortBy from 'ramda/src/sortBy'
import reverse from 'ramda/src/reverse'
import prop from 'ramda/src/prop'
import head from 'ramda/src/head'
import propEq from 'ramda/src/propEq'
import find from 'ramda/src/find'
import map from 'ramda/src/map'

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
    .then(({ data: { data: { transactions: { edges } } } }) => edges.map(e => e.node))
    .then(formatNodes)
    .then(head)
    .then(record => arweave.api.get(record.id))
    .then(({ data }) => data)

}


function formatNodes(nodes) {
  return compose(
    reverse,
    sortBy(prop("timestamp")),
    map(txToProfile)
  )(nodes)
}

function getTag(name) {
  return compose(
    prop('value'),
    find(propEq('name', name))
  )
}

function txToProfile(tx) {
  const tsValue = getTag('Timestamp')(tx.tags)
  const timestamp = tsValue ? tsValue : new Date().toISOString()
  const page = {
    id: tx.id,
    owner: tx.owner.address,

    timestamp
  }
  return page
}