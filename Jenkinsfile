pipeline {
    agent any

    environment {
        NODE_VERSION = '18'
        DOCKER_REGISTRY = 'your-registry.com'
        DOCKER_IMAGE = 'microservices-ecommerce'
        KUBECONFIG = credentials('kubeconfig')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Setup Node.js') {
            steps {
                script {
                    sh """
                        echo 'Setting up Node.js environment'
                        node --version
                        npm --version
                    """
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Lint') {
            steps {
                sh 'npm run lint'
            }
        }

        stage('Type Check') {
            steps {
                sh 'npm run type-check'
            }
        }

        stage('Test') {
            parallel {
                stage('Unit Tests') {
                    steps {
                        sh 'npm run test:unit'
                    }
                }
                stage('Integration Tests') {
                    steps {
                        sh 'npm run test:integration'
                    }
                }
            }
            post {
                always {
                    publishTestResults testResultsPattern: '**/test-results.xml'
                    publishCoverage adapters: [coberturaAdapter('coverage/cobertura-coverage.xml')], sourceFileResolver: sourceFiles('STORE_LAST_BUILD')
                }
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }

        stage('Security Scan') {
            steps {
                sh 'npm audit --audit-level moderate'
                sh 'npm run security:scan'
            }
        }

        stage('Docker Build') {
            when {
                anyOf {
                    branch 'main'
                    branch 'develop'
                }
            }
            parallel {
                stage('API Gateway') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/api-gateway:${BUILD_NUMBER}", "-f packages/api-gateway/Dockerfile .")
                        }
                    }
                }
                stage('User Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/user-service:${BUILD_NUMBER}", "-f packages/user-service/Dockerfile .")
                        }
                    }
                }
                stage('Product Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/product-service:${BUILD_NUMBER}", "-f packages/product-service/Dockerfile .")
                        }
                    }
                }
                stage('Order Service') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/order-service:${BUILD_NUMBER}", "-f packages/order-service/Dockerfile .")
                        }
                    }
                }
                stage('Frontend') {
                    steps {
                        script {
                            docker.build("${DOCKER_REGISTRY}/${DOCKER_IMAGE}/frontend:${BUILD_NUMBER}", "-f apps/frontend/Dockerfile .")
                        }
                    }
                }
            }
        }

        stage('Deploy to Staging') {
            when {
                branch 'develop'
            }
            steps {
                script {
                    withKubeConfig([credentialsId: 'kubeconfig']) {
                        sh """
                            kubectl set image deployment/api-gateway api-gateway=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/api-gateway:${BUILD_NUMBER} -n staging
                            kubectl set image deployment/user-service user-service=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/user-service:${BUILD_NUMBER} -n staging
                            kubectl set image deployment/product-service product-service=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/product-service:${BUILD_NUMBER} -n staging
                            kubectl set image deployment/order-service order-service=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/order-service:${BUILD_NUMBER} -n staging
                            kubectl set image deployment/frontend frontend=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/frontend:${BUILD_NUMBER} -n staging

                            kubectl rollout status deployment/api-gateway -n staging
                            kubectl rollout status deployment/user-service -n staging
                            kubectl rollout status deployment/product-service -n staging
                            kubectl rollout status deployment/order-service -n staging
                            kubectl rollout status deployment/frontend -n staging
                        """
                    }
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            input {
                message "Deploy to production?"
            }
            steps {
                script {
                    withKubeConfig([credentialsId: 'kubeconfig']) {
                        sh """
                            kubectl set image deployment/api-gateway api-gateway=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/api-gateway:${BUILD_NUMBER} -n production
                            kubectl set image deployment/user-service user-service=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/user-service:${BUILD_NUMBER} -n production
                            kubectl set image deployment/product-service product-service=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/product-service:${BUILD_NUMBER} -n production
                            kubectl set image deployment/order-service order-service=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/order-service:${BUILD_NUMBER} -n production
                            kubectl set image deployment/frontend frontend=${DOCKER_REGISTRY}/${DOCKER_IMAGE}/frontend:${BUILD_NUMBER} -n production

                            kubectl rollout status deployment/api-gateway -n production
                            kubectl rollout status deployment/user-service -n production
                            kubectl rollout status deployment/product-service -n production
                            kubectl rollout status deployment/order-service -n production
                            kubectl rollout status deployment/frontend -n production
                        """
                    }
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            slackSend(
                color: 'good',
                message: "✅ Pipeline succeeded for ${env.JOB_NAME} - ${env.BUILD_NUMBER}"
            )
        }
        failure {
            slackSend(
                color: 'danger',
                message: "❌ Pipeline failed for ${env.JOB_NAME} - ${env.BUILD_NUMBER}"
            )
        }
    }
}